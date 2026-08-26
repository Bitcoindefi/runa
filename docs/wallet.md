# Wallet en Runa

La interfaz se abre con `V` desde la ciudad. Muestra tres estados distintos:

- **sin wallet**: no hay identidad Stellar asociada a la partida;
- **direccion vinculada**: existe una cuenta publica `G...`, pero no se afirma
  que el juego pueda firmar por ella;
- **firma externa conectada**: un adaptador de wallet puede firmar el XDR fuera
  del proceso del juego.

Enter o `A` abre el ingreso de la direccion publica. `X` la desvincula y Escape
vuelve al mapa. La direccion se valida con `StrKey` y se guarda en la ranura de
la partida. Una seed secreta `S...` se rechaza y nunca entra al guardado.

`WalletSession` recibe un adaptador por inyeccion con `signTransaction(xdr)`.
Esto deja preparada la frontera para una wallet real sin acoplar el TUI a una
extension de navegador. En la version actual no se incluye un adaptador: por
eso la pantalla dice honestamente **solo identidad**.

Para publicar apuestas falta configurar dos datos externos que no existen en el
repositorio: el id desplegado de `contracts/duel-arena` y un firmante. En una
aplicacion web, Stellar recomienda Stellar Wallets Kit. En terminal se puede
usar un companion web con WalletConnect o un flujo SEP-7; ambos mantienen la
autorizacion fuera de Runa.

- Wallets recomendadas: https://developers.stellar.org/docs/tools/developer-tools/wallets
- SEP-7: https://developers.stellar.org/docs/build/apps/wallet/sep7
- Firma Soroban: https://developers.stellar.org/docs/build/guides/transactions/signing-soroban-invocations
