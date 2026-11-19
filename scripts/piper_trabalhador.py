"""Mantém a voz Piper carregada e sintetiza um WAV por pedido, já com o som afinado.

Lê do stdin uma linha JSON por pedido:
  {"texto", "ficheiro", "escala", "ruido", "ruidoDuracao",
   "volume", "altura", "graves", "medios", "agudos"}
Responde no stdout com uma linha JSON: {"ok": true, "niveis": [...]} ou {"ok": false, "erro": "..."}
A primeira linha que escreve é {"pronto": true} (ou o erro de carregamento).

- altura: meios-tons (-6 a +6). Muda o tom sem mudar a velocidade: sintetiza mais
  devagar/depressa pelo mesmo fator e depois reamostra.
- graves / medios / agudos: ganho em dB (-12 a +12), equalizador de 3 bandas por FFT.
- niveis: o volume da frase em 20 ms por ponto (0..1), para o visualizador da barra.
"""

import json
import math
import sys
import wave

import numpy as np


def curva_eq(freqs, graves, medios, agudos):
    """Ganho (dB) por frequência: prateleira de graves (~250 Hz), sino de médios (~1,2 kHz),
    prateleira de agudos (~4 kHz). Transições suaves em escala logarítmica."""
    f = np.maximum(freqs, 1.0)
    lf = np.log2(f)
    baixo = 1.0 / (1.0 + np.exp((lf - math.log2(250.0)) * 3.0))
    alto = 1.0 / (1.0 + np.exp(-(lf - math.log2(4000.0)) * 3.0))
    sino = np.exp(-((lf - math.log2(1200.0)) ** 2) / (2 * 1.1**2))
    return graves * baixo + medios * sino + agudos * alto


def afinar(x, taxa, p):
    graves = float(p.get("graves") or 0)
    medios = float(p.get("medios") or 0)
    agudos = float(p.get("agudos") or 0)
    altura = float(p.get("altura") or 0)
    volume = float(p.get("volume") if p.get("volume") is not None else 1.0)

    if altura:
        fator = 2 ** (altura / 12.0)
        # A síntese já foi feita `fator` vezes mais longa; encurtar reamostrando sobe o tom.
        n = int(len(x) / fator)
        if n > 1:
            x = np.interp(np.linspace(0, len(x) - 1, n), np.arange(len(x)), x)

    if graves or medios or agudos:
        espectro = np.fft.rfft(x)
        freqs = np.fft.rfftfreq(len(x), 1.0 / taxa)
        espectro *= 10 ** (curva_eq(freqs, graves, medios, agudos) / 20.0)
        x = np.fft.irfft(espectro, n=len(x))

    x = x * max(0.0, min(2.0, volume))
    pico = float(np.max(np.abs(x))) if len(x) else 0.0
    if pico > 0.98:  # limitador simples: nunca satura
        x = x * (0.98 / pico)
    return x.astype(np.float32)


def niveis(x, taxa, ms=20):
    passo = max(1, int(taxa * ms / 1000))
    n = len(x) // passo
    if n == 0:
        return []
    blocos = x[: n * passo].reshape(n, passo)
    rms = np.sqrt(np.mean(blocos**2, axis=1))
    topo = float(np.percentile(rms, 95)) or 1.0
    return [round(min(1.0, float(v) / topo), 2) for v in rms]


def main() -> int:
    sys.stdin.reconfigure(encoding="utf-8")
    sys.stdout.reconfigure(encoding="utf-8")
    try:
        from piper import PiperVoice, SynthesisConfig

        padrao = sys.argv[1]
        vozes = {padrao: PiperVoice.load(padrao)}  # cache das vozes carregadas (as mais usadas ficam)
        ordem = [padrao]
    except Exception as erro:  # noqa: BLE001
        print(json.dumps({"pronto": False, "erro": str(erro)}), flush=True)
        return 1
    print(json.dumps({"pronto": True, "taxa": vozes[padrao].config.sample_rate}), flush=True)

    def obter_voz(caminho):
        caminho = caminho or padrao
        if caminho not in vozes:
            vozes[caminho] = PiperVoice.load(caminho)
            ordem.append(caminho)
            while len(ordem) > 4:  # no máximo 4 vozes em memória
                velha = ordem.pop(0)
                if velha != padrao:
                    vozes.pop(velha, None)
                else:
                    ordem.append(velha)
        return vozes[caminho]

    for linha in sys.stdin:
        linha = linha.strip()
        if not linha:
            continue
        try:
            p = json.loads(linha)
            voz = obter_voz(p.get("modelo"))
            taxa = voz.config.sample_rate
            altura = float(p.get("altura") or 0)
            config = SynthesisConfig(
                length_scale=float(p.get("escala") or 1.0) * (2 ** (altura / 12.0)),
                noise_scale=float(p.get("ruido") or 0.4),
                noise_w_scale=float(p.get("ruidoDuracao") or 0.5),
            )
            partes = [c.audio_float_array for c in voz.synthesize(p["texto"], syn_config=config)]
            x = np.concatenate(partes) if partes else np.zeros(0, dtype=np.float32)
            x = afinar(x, taxa, p)
            pan = max(-1.0, min(1.0, float(p.get("pan") or 0)))
            with wave.open(p["ficheiro"], "wb") as saida:
                saida.setsampwidth(2)
                saida.setframerate(taxa)
                if pan:
                    # Som espacial: cada conversa fala do seu lado (o ouvido mais perto fica a 100%).
                    th = (pan + 1) * math.pi / 4
                    ge, gd = math.cos(th), math.sin(th)
                    m = max(ge, gd)
                    estereo = np.stack([x * (ge / m), x * (gd / m)], axis=1)
                    saida.setnchannels(2)
                    saida.writeframes((estereo * 32767).astype("<i2").tobytes())
                else:
                    saida.setnchannels(1)
                    saida.writeframes((x * 32767).astype("<i2").tobytes())
            print(json.dumps({"ok": True, "segundos": round(len(x) / taxa, 2), "niveis": niveis(x, taxa)}), flush=True)
        except Exception as erro:  # noqa: BLE001
            print(json.dumps({"ok": False, "erro": f"{type(erro).__name__}: {erro}"}), flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
