// Authentication & user API key management — see state.ts for the shared
// users/userTokens/userPasswords state and auth helpers this all builds on.
import express from 'express';
import { AuthUser, UserApiKey } from '../../types.ts';
import {
  broadcastWebSocket,
  computeGrantableKeyPermissions,
  generateApiKey,
  generateSessionToken,
  getAuthenticatedUser,
  hashPassword,
  hubConfig,
  saveAuthState,
  users,
  userPasswords,
  userTokens,
  verifyPassword,
} from '../state.ts';

const router = express.Router();

// Register new user
router.post('/api/auth/register', (req, res) => {
  const { name, email, password, role } = req.body;
  if (!email || !password || !name) {
    res.status(400).json({ error: 'Naam, e-mailadres en wachtwoord zijn verplicht' });
    return;
  }

  const existing = users.find((u) => u.email.toLowerCase() === email.toLowerCase());
  if (existing) {
    res.status(409).json({ error: 'Een account met dit e-mailadres bestaat al' });
    return;
  }

  const VALID_ROLES = ['admin', 'audiophile', 'operator', 'guest'];
  const requestedRole = VALID_ROLES.includes(role) ? role : 'audiophile';
  // Requesting the caller's own admin-ness lets them mint MORE admins —
  // requiring the global mutation gate's authUser to already hold
  // admin:all closes what would otherwise be a privilege-escalation path:
  // any authenticated-but-low-privilege caller (even a read-only API key)
  // could previously just ask for role: 'admin' and get one.
  const caller = (req as any).authUser as AuthUser | undefined;
  const callerIsAdmin = Boolean(caller?.apiKeys.some((k) => k.permissions.includes('admin:all')));
  if (requestedRole === 'admin' && !callerIsAdmin) {
    res.status(403).json({ error: 'Alleen een bestaande admin kan een nieuw admin-account aanmaken' });
    return;
  }
  const assignedRole = requestedRole;

  const newUserId = 'user-' + Date.now();
  // Every new account used to get a full-admin key regardless of the role
  // it was registered with — least-privilege by default instead; only an
  // explicit admin role (itself now gated above) gets dac:configure/admin:all.
  const initialApiKey: UserApiKey = {
    id: 'key-' + Date.now(),
    name: 'Standaard Web & Audio API Sleutel',
    key: generateApiKey(),
    createdAt: new Date().toISOString().replace('T', ' ').substring(0, 19),
    lastUsedAt: null,
    permissions: assignedRole === 'admin' ? ['audio:read', 'audio:control', 'dac:configure', 'admin:all'] : ['audio:read', 'audio:control'],
    status: 'active',
  };

  const newUser: AuthUser = {
    id: newUserId,
    email: email.trim(),
    name: name.trim(),
    role: assignedRole,
    createdAt: new Date().toISOString().split('T')[0],
    apiKeys: [initialApiKey],
  };

  users.push(newUser);
  userPasswords[email.trim()] = hashPassword(password);

  const token = generateSessionToken();
  userTokens.set(token, newUserId);
  saveAuthState();

  broadcastWebSocket({
    event: 'auth_event',
    timestamp: Date.now(),
    data: { type: 'register', user: { id: newUser.id, name: newUser.name, email: newUser.email } },
  });

  res.status(201).json({
    success: true,
    token,
    user: newUser,
    message: 'Account succesvol geregistreerd en API-sleutel gegenereerd',
  });
});

// Login existing user
router.post('/api/auth/login', (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    res.status(400).json({ error: 'E-mail en wachtwoord zijn verplicht' });
    return;
  }

  const user = users.find((u) => u.email.toLowerCase() === email.toLowerCase().trim());
  if (!user) {
    res.status(401).json({ error: 'Onjuist e-mailadres of wachtwoord' });
    return;
  }

  // No stored hash used to mean "skip the check, log them in anyway" — an
  // account with no password on record should never be able to log in.
  const storedHash = userPasswords[user.email];
  if (!storedHash || !verifyPassword(password, storedHash)) {
    res.status(401).json({ error: 'Onjuist e-mailadres of wachtwoord' });
    return;
  }

  const token = generateSessionToken();
  userTokens.set(token, user.id);
  saveAuthState();

  res.json({
    success: true,
    token,
    user,
    message: 'Succesvol ingelogd',
  });
});

// Get current user profile
router.get('/api/auth/me', (req, res) => {
  const auth = getAuthenticatedUser(req);
  if (!auth.user) {
    res.status(401).json({ error: 'Niet geauthenticeerd' });
    return;
  }
  res.json({ user: auth.user, activeApiKey: auth.apiKey });
});

// Change the current user's own password
router.put('/api/auth/password', (req, res) => {
  const auth = getAuthenticatedUser(req);
  if (!auth.user) {
    res.status(401).json({ error: 'Niet geauthenticeerd' });
    return;
  }
  const { currentPassword, newPassword } = req.body || {};
  if (!currentPassword || !newPassword || typeof newPassword !== 'string' || newPassword.length < 8) {
    res.status(400).json({ error: 'Huidig en nieuw wachtwoord zijn verplicht; nieuw wachtwoord moet minstens 8 tekens zijn' });
    return;
  }
  const storedHash = userPasswords[auth.user.email];
  if (!storedHash || !verifyPassword(currentPassword, storedHash)) {
    res.status(401).json({ error: 'Huidig wachtwoord is onjuist' });
    return;
  }
  userPasswords[auth.user.email] = hashPassword(newPassword);
  saveAuthState();
  res.json({ success: true, message: 'Wachtwoord gewijzigd' });
});

// Roster of accounts with access to this hub. GET, so it isn't covered by
// the mutation-only auth gate above — guarded explicitly here instead,
// since the full `users` array carries every account's raw, live API keys
// and this must never be readable without a valid credential. Even once
// authenticated, only the caller's own key strings come back in full;
// everyone else's are redacted to a preview, matching what the roster UI
// actually needs (name/email/role) without handing out usable secrets.
router.get('/api/auth/users', (req, res) => {
  const auth = getAuthenticatedUser(req);
  if (!auth.user) {
    res.status(401).json({ error: auth.error || 'Niet geauthenticeerd' });
    return;
  }
  const redacted = users.map((u) => {
    if (u.id === auth.user!.id) return u;
    return {
      ...u,
      apiKeys: u.apiKeys.map((k) => ({ ...k, key: k.key.slice(0, 16) + '••••••••' })),
    };
  });
  res.json({ users: redacted });
});

// Logout
router.post('/api/auth/logout', (req, res) => {
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.substring(7).trim();
    userTokens.delete(token);
    saveAuthState();
  }
  res.json({ success: true, message: 'Succesvol uitgelogd' });
});

// Generate new API key for authenticated user
router.post('/api/auth/keys', (req, res) => {
  const auth = getAuthenticatedUser(req);
  if (!auth.user) {
    res.status(401).json({ error: 'Log in om een API-sleutel aan te maken' });
    return;
  }

  const { name, permissions, expiresDays } = req.body;
  const keyString = generateApiKey();

  let expiresAt: string | null = null;
  if (expiresDays && typeof expiresDays === 'number' && expiresDays > 0) {
    const exp = new Date(Date.now() + expiresDays * 24 * 60 * 60 * 1000);
    expiresAt = exp.toISOString().replace('T', ' ').substring(0, 19);
  }

  const callerPermissions = new Set(auth.user.apiKeys.flatMap((k) => k.permissions));
  const granted = computeGrantableKeyPermissions(permissions, callerPermissions);

  const newKey: UserApiKey = {
    id: 'key-' + Date.now(),
    name: name || 'API Client Key',
    key: keyString,
    createdAt: new Date().toISOString().replace('T', ' ').substring(0, 19),
    lastUsedAt: null,
    permissions: granted.length > 0 ? granted : ['audio:read', 'audio:control'],
    status: 'active',
    expiresAt,
  };

  auth.user.apiKeys.unshift(newKey);

  // If this is the current primary admin, update global hubConfig key reference
  if (auth.user.id === 'user-admin') {
    hubConfig.apiKey = keyString;
  }
  saveAuthState();

  broadcastWebSocket({
    event: 'notification',
    timestamp: Date.now(),
    data: { message: `Nieuwe API-sleutel '${newKey.name}' aangemaakt voor ${auth.user.name}` },
  });

  res.status(201).json({ success: true, apiKey: newKey, user: auth.user });
});

// Revoke/Delete API key
router.delete('/api/auth/keys/:keyId', (req, res) => {
  const auth = getAuthenticatedUser(req);
  if (!auth.user) {
    res.status(401).json({ error: 'Niet geauthenticeerd' });
    return;
  }

  const keyIndex = auth.user.apiKeys.findIndex((k) => k.id === req.params.keyId);
  if (keyIndex === -1) {
    res.status(404).json({ error: 'API-sleutel niet gevonden' });
    return;
  }

  const removed = auth.user.apiKeys.splice(keyIndex, 1)[0];
  saveAuthState();
  res.json({ success: true, message: `API-sleutel '${removed.name}' ingetrokken`, user: auth.user });
});

// Rotate/Regenerate API key
router.post('/api/auth/keys/:keyId/rotate', (req, res) => {
  const auth = getAuthenticatedUser(req);
  if (!auth.user) {
    res.status(401).json({ error: 'Niet geauthenticeerd' });
    return;
  }

  const keyObj = auth.user.apiKeys.find((k) => k.id === req.params.keyId);
  if (!keyObj) {
    res.status(404).json({ error: 'API-sleutel niet gevonden' });
    return;
  }

  keyObj.key = generateApiKey();
  keyObj.createdAt = new Date().toISOString().replace('T', ' ').substring(0, 19);

  if (auth.user.id === 'user-admin' && auth.user.apiKeys[0]?.id === keyObj.id) {
    hubConfig.apiKey = keyObj.key;
  }
  saveAuthState();

  res.json({ success: true, apiKey: keyObj, user: auth.user });
});

export default router;
