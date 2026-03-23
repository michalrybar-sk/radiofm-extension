# Rádio FM Player

Rozšírenie pre prehliadač Opera a Chrome, ktoré ti umožňuje počúvať [Rádio FM](https://fm.stvr.sk) priamo z panela prehliadača.

## Funkcie

- Prehrávanie online streamu Rádio FM (256 kbps, záložný 128 kbps)
- Zobrazenie názvu aktuálne hranej skladby v reálnom čase (ICY metadata)
- História posledných 8 skladieb s časom odvysielania
- Zobrazenie aktuálnej relácie s časom začiatku
- Ovládanie hlasitosti a stlmenie zvuku
- Podpora Media Session API – názov skladby a logo v systémových notifikáciách
- Automatický fallback: najprv stream 256 kbps, pri nedostupnosti prepne na 128 kbps
- Minimalistický tmavý dizajn

## Inštalácia

### Z obchodu
- [Opera Add-ons](https://addons.opera.com) *(čoskoro)*
- [Chrome Web Store](https://chrome.google.com/webstore) *(čoskoro)*

### Manuálna inštalácia
1. Stiahni ZIP zo záložky [Releases](../../releases)
2. Rozbali archív
3. V prehliadači otvor `opera://extensions` alebo `chrome://extensions`
4. Zapni **Režim vývojára**
5. Klikni na **Načítať rozbalené** a vyber rozbalený priečinok

## Technológie

- Manifest V3
- Offscreen Document API (prehrávanie audia na pozadí)
- ICY metadata (real-time názov skladby)
- Media Session API (systémové notifikácie)

## Licencia

MIT
