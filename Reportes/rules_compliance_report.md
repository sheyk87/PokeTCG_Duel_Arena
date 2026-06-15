# Informe: Cumplimiento de Reglas del Sistema de Juego

Este informe analiza el cumplimiento del motor de juego del servidor (`server/gameState.js`) respecto a las reglas oficiales descritas en `Reglas.txt` y `cri_rulebook_latam.md`. 

---

## 1. Resumen de Reglas Oficiales vs. Implementación en Servidor

El motor de juego del servidor (`ServerGameState`) automatiza una parte importante de las reglas del juego de cartas coleccionables Pokémon (JCC), pero delega otras al cliente o al control manual de los jugadores mediante un **Modo Sandbox Multijugador**.

A continuación, se presenta una matriz detallada del cumplimiento de las reglas básicas y avanzadas:

| Regla Oficial (Manual de Reglas) | Estado en el Servidor | Detalle de Implementación y Desviaciones |
| :--- | :---: | :--- |
| **Tamaño del Mazo:** Exactamente 60 cartas. | **Parcial** | El servidor no valida el tamaño del mazo en el código de inicialización del duelo; baraja y expande las cartas que recibe de la base de datos (`server.js` L453). Depende de la validación previa del editor de mazos. |
| **Límite de Copias:** Máximo 4 cartas con el mismo nombre (salvo Energías Básicas). | **Parcial** | Delegado a la base de datos y al creador de mazos. El motor del servidor no restringe mazos con más de 4 copias si el cliente los envía. |
| **Requisito de Pokémon Básico:** Al menos 1 Pokémon Básico en el mazo. | **Parcial** | Delegado al editor de mazos. Sin embargo, en la fase de `setup` se requiere colocar al menos 1 Activo Básico para iniciar. |
| **Mano Inicial y Premios:** Robar 7 cartas para la mano y separar 6 cartas de Premio boca abajo. | **Cumple** | `initPlayerState()` roba 7 cartas del mazo para la mano y luego remueve las siguientes 6 cartas para colocarlas en la zona de premios (`gameState.js` L40-56). |
| **Regla de Mulligan:** Si no hay Pokémon Básico en la mano inicial, mostrar la mano, barajar y robar 7. El oponente roba 1 por mulligan. | **Parcial** | El servidor valida y resuelve la acción de barajar y robar una nueva mano (`handleMulligan()`). Sin embargo, **no automatiza el robo de cartas extra del oponente por cada mulligan**. Los jugadores deben ejecutar esto de forma manual usando acciones de Sandbox o mediante lógica de cliente. |
| **Límite de Banca:** Máximo 5 Pokémon en Banca. | **Cumple** | `gameState.js` inicializa la banca con `[null, null, null, null, null]` (5 slots) y `handlePlaceBench()` rechaza la colocación si el slot está ocupado o fuera de rango (0-4). |
| **Límite de Unión de Energía:** 1 carta de Energía de la mano a un Pokémon por turno. | **Cumple** | Controlado por la bandera `player.energyAttachedThisTurn = true`. Se resetea en `endTurn()`. |
| **Restricción de Evolución:** No evolucionar en el turno en que entra en juego el Pokémon. | **Cumple** | `handleEvolve()` valida que `targetPkmn.turnPlaced < this.turnNumber` (L421). |
| **Restricción de Evolución Turno 1:** No se puede evolucionar en el primer turno de la partida o en el primer turno de cada jugador. | **Desviación** | El servidor permite evolucionar Pokémon colocados durante el setup en el Turno 1 de la partida, ya que su `turnPlaced` es 0 y el `turnNumber` es 1 (`0 < 1` es verdadero). Oficialmente, ningún jugador puede evolucionar en su primer turno. |
| **Límites de Entrenadores:** Máximo 1 Partidario y 1 Estadio por turno. | **No Cumple** | El servidor no lleva un registro ni restringe si un jugador juega más de 1 Partidario o Estadio en un turno (`handlePlayTrainer()` no valida este límite). |
| **Retirada del Activo:** Pagar el costo de retirada descartando energías unidas. Máximo 1 retirada por turno. | **Cumple** | Se restringe con `player.retreatedThisTurn = true`. Se descarta energía según el costo (`handleRetreat()` L751-800). |
| **Restricción de Retirada por Condición:** Pokémon Dormido o Paralizado no puede retirarse. | **No Cumple** | `handleRetreat()` **no valida** si el Pokémon está Dormido o Paralizado antes de permitir la retirada. |
| **Restricción de Ataque por Condición:** Pokémon Dormido o Paralizado no puede atacar. | **Cumple** | Validado en `handleAttack()` L534-539. |
| **Ataque de Pokémon Confundido:** Lanzar moneda. Si sale cruz, el ataque falla y el atacante recibe 30 de daño (3 contadores). | **Desviación** | El servidor realiza el chequeo del lanzamiento de moneda (`handleAttack` L545-564). Si sale cruz, el ataque falla pero **le inflige 20 de daño en lugar de los 30 reglamentarios** (3 contadores de daño = 30 puntos). |
| **Condición Especial: Envenenado** (1 contador entre turnos). | **Cumple** | Se aplica 10 puntos de daño en cada fase de chequeo entre turnos (`endTurn()` L890-897). |
| **Condición Especial: Dormido** (Lanzar moneda entre turnos. Cura en cara). | **Cumple** | Resuelto entre turnos con probabilidad de 50% de cura (`endTurn()` L898-907). |
| **Condición Especial: Paralizado** (Dura hasta el final del siguiente turno). | **Cumple** | Se limpia al final del turno propio del jugador afectado (`endTurn()` L908-915). |
| **Condición Especial: Quemado** (20 de daño entre turnos. Lanzar moneda para curar). | **No Cumple** | **La condición de Quemado está completamente ausente** en la lógica automática de fin de turno (`endTurn()`). No se aplica daño automático de quemadura ni lanzamientos de moneda de recuperación. |
| **Condiciones de Victoria Estándar:** Tomar los 6 Premios, dejar al rival sin Pokémon en juego, o Deck Out del rival al iniciar su turno. | **Cumple** | Automatizado en `checkAndResolveKnockouts()` y `endTurn()` (para Deck Out). |
| **Victoria Simultánea:** Si ambos jugadores logran condiciones de victoria a la vez, se realiza una partida de desempate de 1 Premio. | **Desviación** | El servidor resuelve el empate otorgando la victoria inmediata al jugador activo que está atacando en ese turno (`checkAndResolveKnockouts()` L1031-1042). |

---

## 2. Análisis Detallado de las Desviaciones Críticas

### A. Daño de Confusión (Desviación cuantitativa)
- **Regla Oficial (`Reglas.txt` L652-654):** *"Si sale cruz, el ataque no se realiza, y pondrás 3 contadores de daño en el Pokémon Confundido."* (3 contadores = 30 daño).
- **Código en Servidor (`gameState.js` L554):** `player.active.damage += 20;`
- **Impacto:** Un Pokémon confundido que falla su ataque recibe 10 puntos de daño menos de lo que debería. Esto debilita la efectividad táctica de los ataques que causan Confusión.

### B. Ausencia de la Condición "Quemado" (Brecha de funcionalidad)
- **Regla Oficial (`Reglas.txt` L601-605):** *"Durante el Chequeo Pokémon, pon 2 contadores de daño en tu Pokémon Quemado. Después, lanza 1 moneda. Si sale cara, el Pokémon se recuperará..."*
- **Código en Servidor:** No existe ninguna mención de `burned` o `burned-damage` en la rutina `endTurn()`.
- **Impacto:** Los ataques que queman no aplican daño residual automático. Los jugadores deben registrar manualmente el daño de quemadura (20 puntos) entre turnos usando el modo Sandbox.

### C. Retirada de Pokémon Dormidos o Paralizados (Brecha de restricción)
- **Regla Oficial (`Reglas.txt` L624-625):** *"Las únicas Condiciones Especiales que evitan que los Pokémon puedan retirarse son las de Dormido y Paralizado."*
- **Código en Servidor (`gameState.js` L751):** `handleRetreat()` no revisa `player.active.specialCondition`.
- **Impacto:** Permite a los jugadores retirar libremente Pokémon inmovilizados pagando su costo de retirada, lo cual anula el efecto de inmovilización de Dormido y Paralizado.

### D. Resolución de Empates / Victorias Simultáneas (Simplificación de arquitectura)
- **Regla Oficial (`Reglas.txt` L758-768):** *"En este caso, hay que recurrir a una partida de desempate. [...] El primer jugador que tome 1 carta de Premio [...] gana."* (Muerte súbita a 1 Premio).
- **Código en Servidor (`gameState.js` L1032-1041):** `const winnerId = this.turnOwnerId;` (Gana el jugador atacante).
- **Impacto:** Evita tener que reiniciar un duelo en modo "muerte súbita", decidiendo el ganador de forma determinista para no extender la sesión.

---

## 3. El Rol Compensatorio del Modo Sandbox Multijugador

Una característica fundamental de este proyecto es la inclusión del **Modo Sandbox Manual** (acciones que comienzan con `MANUAL_` en `gameState.js` L1180-1467). Esta arquitectura actúa como un sistema "Tabletop Simulator".

Cuando el motor automático del servidor no cumple o desvía alguna regla, los jugadores pueden autogestionar el cumplimiento de la siguiente manera:
1. **Mulligans:** Si un jugador tiene mulligans, el rival puede usar `MANUAL_DRAW` para robar sus cartas de bonificación correspondientes.
2. **Quemaduras:** Al final del turno, el jugador afectado puede lanzar una moneda física o virtual (`MANUAL_FLIP_COIN`) y aplicarse 20 de daño (`MANUAL_DAMAGE_CHANGE`) si es necesario.
3. **Límite de Entrenadores / Retiradas de Dormidos:** Los jugadores deben autorregularse y acordar de forma amistosa no realizar acciones ilegales, o corregirlas deshaciendo movimientos mediante `MANUAL_CARD_MOVEMENT`.
4. **Desempate:** Si ocurre una victoria simultánea y los jugadores desean apegarse a las reglas oficiales, pueden iniciar una nueva partida estándar y jugar hasta que uno de los dos tome su primer premio (Sandbox permite mover los otros 5 premios al descarte o mazo para simular la muerte súbita).

En conclusión, aunque el servidor presenta varias desviaciones respecto al reglamento oficial de Pokémon TCG 2026, el diseño de Sandbox abierto permite emular el reglamento al 100% mediante la autogestión de los jugadores en la mesa virtual.
