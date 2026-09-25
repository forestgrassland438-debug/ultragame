# Exportar y probar juegos de UltraGame Studio

En **Archivo** hay tres salidas para jugar y una copia editable:

| Opción | Uso |
| --- | --- |
| Descargar ZIP (web) | Descomprime todo y sirve la carpeta por HTTP/HTTPS. `index.html`, scripts y `assets/` deben permanecer juntos. |
| Exportar a carpeta (disco) | Genera los mismos archivos en `projects/<id>/export/`. Requiere iniciar el servidor de Studio. |
| Descargar HTML único | Incluye motor, proyecto, scripts y recursos en un archivo. En PC puede abrirse directamente en un navegador. |
| Descargar proyecto (.ugs.json) | Copia editable que incluye los recursos. Se importa desde el gestor de proyectos. |

En un teléfono, abre la dirección HTTPS del juego publicado en el navegador. Los visores de archivos de algunas aplicaciones muestran el HTML como documento y no ejecutan JavaScript. El ZIP necesita descompresión y un servidor; abrir un archivo dentro del ZIP no instala ni ejecuta el juego. Una API externa o una cartera real sigue requiriendo su servicio/conexión aunque se use HTML único.

## Recursos y scripts

Importa el modelo y sus archivos asociados: `.gltf` con sus `.bin` y texturas; `.obj` con `.mtl` y texturas; mapas Tiled con sus tilesets e imágenes. Mantén las referencias relativas de esos archivos iguales a los nombres importados. El almacén de Studio utiliza una carpeta `assets/` plana; un GLB que incluye sus texturas evita tener que transportar archivos adicionales. Las referencias a subcarpetas externas que no se han importado no se crean automáticamente.

El motor conserva ahora las rutas originales al resolver los archivos del proyecto. Esto permite que las referencias relativas funcionen tanto en la vista Jugar como en el HTML con recursos embebidos. Imágenes, fuentes y audio HTML5 pasan por el mismo resolvedor. Un juego con controles de teclado necesita también controles táctiles propios para jugar desde una pantalla táctil; el escalado por sí solo no sustituye esos controles.

Los scripts del HTML único se incorporan como archivos JavaScript codificados en base64. Así se preservan sus bytes, incluidos `String.raw`, comentarios y textos que contienen `</script>`, sin romper las etiquetas del documento. Los scripts del ZIP continúan siendo archivos `.js` normales.

## Correcciones y comprobación

- La exportación mantiene el proyecto seleccionado al comenzar, aunque se cambie de proyecto mientras se leen los recursos.
- Los recursos compartidos por varias entradas se escriben una sola vez. Los archivos ausentes y las rutas de exportación duplicadas generan un error explícito.
- La importación de `.ugs.json` rechaza paquetes incompletos, base64 dañado, versiones desconocidas y recursos de más de 64 MB antes de crear el proyecto.
- Un fallo asíncrono de arranque aparece en pantalla en el juego exportado.
- El área de juego usa la altura dinámica del navegador móvil y evita desplazar la página al tocar el canvas.
- La exportación de contratos incluye los `.sol` dentro de `contracts/hardhat/contracts/`, junto a la configuración de ese proyecto Hardhat.

Pruebas de regresión:

```text
node --test tests/node-tests-export.js
node tests/node-tests.js
```

Las pruebas incluyen un glTF con binario externo real, un OBJ con su MTL, un mapa Tiled con tileset externo, fuentes/audio/imágenes resueltos desde recursos embebidos, integridad de scripts y conservación de los recursos al exportar/importar. La verificación de un proyecto concreto sigue incluyendo abrir su exportación y comprobar sus controles en los dispositivos de destino.
