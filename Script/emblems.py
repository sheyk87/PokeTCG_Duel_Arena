import os
import requests

# 1. Configuraciones iniciales
api_url = "https://api.dotgg.gg/cgfw/getgacha?game=pokepocket&type=accessories&cache=4953"
base_url = "https://static.dotgg.gg/pokepocket/"
root_dir = r"C:\Users\UNaB\Desktop\Emblems"

print("Conectando con la API para obtener el listado completo...")

try:
    # 2. Obtener el JSON vivo directamente de la API
    response = requests.get(api_url)
    response.raise_for_status()
    data = response.json()
    
    print(f"Total de elementos detectados en el JSON: {len(data)}")
    print("Iniciando la descarga organizada por categorías...\n")
    
    # Contadores para el reporte final
    descargados = 0
    errores = 0

    # 3. Procesar absolutamente todos los elementos
    for item in data:
        icon_path = item.get("icon")
        # Validamos que tenga una ruta de imagen válida
        if not icon_path:
            continue
            
        # Detectar el tipo (emblems, coins, backdrops, playmats, etc.)
        # Si no tiene tipo, lo mandamos a una carpeta genérica 'otros'
        folder_type = item.get("type", "otros")
        
        # Estructurar la URL de descarga y la ruta local en el Escritorio
        url_descarga = f"{base_url}{icon_path}"
        filename = icon_path.split("/")[-1]
        
        # Definir la subcarpeta para que no quede todo mezclado (Ej: Emblems\coins, Emblems\backdrops)
        category_dir = os.path.join(root_dir, folder_type)
        os.makedirs(category_dir, exist_ok=True)
        
        filepath = os.path.join(category_dir, filename)
        
        # Evitar re-descargar si el archivo ya existe (por si cortás y volvés a correr el script)
        if os.path.exists(filepath):
            continue
            
        try:
            img_res = requests.get(url_descarga, stream=True, timeout=10)
            if img_res.status_code == 200:
                with open(filepath, "wb") as f:
                    for chunk in img_res.iter_content(1024):
                        f.write(chunk)
                print(f"✅ [{folder_type.upper()}] Descargado: {filename}")
                descargados += 1
            else:
                # Algunos links del JSON de la API pueden estar rotos en su servidor (404)
                print(f"⚠️ [{folder_type.upper()}] No disponible en servidor (HTTP {img_res.status_code}): {filename}")
                errores += 1
                
        except Exception as e:
            print(f"❌ Error al descargar {filename}: {e}")
            errores += 1

    print(f"\n¡Fin del proceso!")
    print(f" Archivos nuevos guardados con éxito: {descargados}")
    print(f" Fallidos o inexistentes en el servidor: {errores}")

except requests.exceptions.RequestException as e:
    print(f"\n❌ Error crítico de conexión con la API: {e}")
except Exception as e:
    print(f"\n❌ Ocurrió un error inesperado en el script: {e}")