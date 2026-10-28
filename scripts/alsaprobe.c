/* alsaprobe — doet dezelfde ALSA-onderhandeling als librespot's AlsaSink,
 * maar controleert elke stap afzonderlijk. Bedoeld voor de vraag "waarom
 * komt er geen geluid uit dit apparaat", want libasound klapt er bij een
 * kapotte apparaatketen uit met een kale assertie zonder te zeggen welke
 * parameter de dader was:
 *
 *     snd1_pcm_hw_param_get_min: Assertion `!snd_interval_empty(i)' failed.
 *
 * Bouwen en draaien op de Pi (vereist gcc en libasound2-dev):
 *     gcc -o /tmp/alsaprobe scripts/alsaprobe.c -lasound
 *     stdbuf -o0 /tmp/alsaprobe default      # stdbuf: anders gaat de uitvoer
 *     stdbuf -o0 /tmp/alsaprobe eq           # bij een crash verloren
 *
 * Exit 0 = dit apparaat is bruikbaar voor librespot. Exit 134 (SIGABRT) =
 * libasound brak af; de laatst geprinte regel wijst de stap aan.
 * Zorg dat de kaart vrij is, anders krijg je alleen "Device or resource busy".
 */
#include <alsa/asoundlib.h>
#include <stdio.h>

static int step(const char *naam, int rc) {
  printf("  %-22s %s\n", naam, rc < 0 ? snd_strerror(rc) : "ok");
  return rc;
}

int main(int argc, char **argv) {
  const char *dev = argc > 1 ? argv[1] : "default";
  snd_pcm_t *pcm;
  int rc = snd_pcm_open(&pcm, dev, SND_PCM_STREAM_PLAYBACK, 0);
  printf("apparaat: %s\n", dev);
  if (rc < 0) { printf("  open                   %s\n", snd_strerror(rc)); return 1; }
  printf("  open                   ok\n");

  snd_pcm_hw_params_t *hw;
  snd_pcm_hw_params_alloca(&hw);
  if (step("hw_params_any", snd_pcm_hw_params_any(pcm, hw)) < 0) return 1;
  step("set_access RW_INTER", snd_pcm_hw_params_set_access(pcm, hw, SND_PCM_ACCESS_RW_INTERLEAVED));
  step("set_format S16_LE",   snd_pcm_hw_params_set_format(pcm, hw, SND_PCM_FORMAT_S16_LE));
  unsigned int rate = 44100;
  step("set_rate_near 44100", snd_pcm_hw_params_set_rate_near(pcm, hw, &rate, 0));
  printf("  -> rate wordt %u\n", rate);
  step("set_channels 2",      snd_pcm_hw_params_set_channels(pcm, hw, 2));

  /* Precies hier klapt librespot eruit: het vraagt de grenzen op. Een leeg
   * interval betekent dat een van de stappen hierboven de ruimte dichtgooide. */
  snd_pcm_uframes_t pmin = 0, pmax = 0, bmin = 0, bmax = 0;
  int d = 0;
  printf("  grenzen opvragen (hier crasht librespot):\n");
  step("get_period_size_min", snd_pcm_hw_params_get_period_size_min(hw, &pmin, &d));
  step("get_period_size_max", snd_pcm_hw_params_get_period_size_max(hw, &pmax, &d));
  step("get_buffer_size_min", snd_pcm_hw_params_get_buffer_size_min(hw, &bmin));
  step("get_buffer_size_max", snd_pcm_hw_params_get_buffer_size_max(hw, &bmax));
  printf("  -> period %lu..%lu, buffer %lu..%lu\n",
         (unsigned long)pmin, (unsigned long)pmax,
         (unsigned long)bmin, (unsigned long)bmax);

  step("hw_params (toepassen)", snd_pcm_hw_params(pcm, hw));
  snd_pcm_close(pcm);
  printf("  KLAAR: dit apparaat werkt voor librespot\n");
  return 0;
}
