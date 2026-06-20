import os
import re

# 1. La ruta de la carpeta donde están las imágenes a renombrar
# Ojo: como en el script anterior separamos en subcarpetas, apuntá a la que corresponda
carpeta_objetivo = r"C:\Users\UNaB\Desktop\PkmnCards\cards\Coins"

# 2. El patrón Regex mágico: 
# Busca desde el principio (^) cualquier texto (.*?) hasta encontrar exactamente 6 dígitos (\d{6}) y un guion (-)
patron = re.compile(r'^.*?\d{6}-')

archivos_renombrados = 0
errores = 0

print(f"Analizando archivos en: {carpeta_objetivo}...\n")

# 3. Iterar sobre todos los archivos de la carpeta
for filename in os.listdir(carpeta_objetivo):
    # Validamos si el archivo cumple con nuestro patrón (si tiene el ID de 6 dígitos)
    if patron.search(filename):
        # Reemplaza todo el fragmento que coincidió por nada (''), dejando solo la parte final
        nuevo_nombre = patron.sub('', filename)
        
        ruta_vieja = os.path.join(carpeta_objetivo, filename)
        ruta_nueva = os.path.join(carpeta_objetivo, nuevo_nombre)
        
        # Validación de seguridad: no sobreescribir si ya existe un archivo con ese nombre
        if not os.path.exists(ruta_nueva):
            try:
                os.rename(ruta_vieja, ruta_nueva)
                print(f"✅ Renombrado: {nuevo_nombre}")
                archivos_renombrados += 1
            except Exception as e:
                print(f"❌ Error al renombrar {filename}: {e}")
                errores += 1
        else:
            print(f"⚠️ Omitido: Ya existe un archivo llamado '{nuevo_nombre}'")

print(f"\n¡Proceso terminado!")
print(f"Se renombraron {archivos_renombrados} archivos exitosamente.")