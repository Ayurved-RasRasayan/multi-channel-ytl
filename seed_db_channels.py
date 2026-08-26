import os
import json

def seed_db_channels():
    # Define potential paths to db_channels.json
    possible_paths = [
        r"C:\Users\Jackle\Downloads\YouTube-Downloader\db_channels.json",
        os.path.join(os.path.dirname(__file__), "server", "db_channels.json"),
        os.path.join(os.path.dirname(__file__), "db_channels.json"),
        "db_channels.json"
    ]

    input_file_path = None
    channels_data = []

    for p in possible_paths:
        if os.path.exists(p):
            input_file_path = p
            break

    if input_file_path:
        try:
            with open(input_file_path, 'r', encoding='utf-8') as f:
                channels_data = json.load(f)
            print(f"Loaded channels from {input_file_path}")
        except Exception as e:
            print(f"Error reading {input_file_path}: {e}")
            channels_data = []
    else:
        print(f"File not found at default locations. Creating new file.")
        channels_data = []

    # Ensure server/db_channels.json is populated
    target_path = os.path.join(os.path.dirname(__file__), "server", "db_channels.json")
    if channels_data and not os.path.exists(target_path):
        try:
            os.makedirs(os.path.dirname(target_path), exist_ok=True)
            with open(target_path, 'w', encoding='utf-8') as f:
                json.dump(channels_data, f, indent=2, ensure_ascii=False)
            print(f"Seeded {target_path} with {len(channels_data)} channels.")
        except Exception as e:
            print(f"Error writing target file: {e}")

    # Display the data for verification
    print(f"Number of channels: {len(channels_data)}")

    # Print a sample of the data
    for idx, channel in enumerate(channels_data):
        print(f"Channel {idx+1}: {channel.get('name')} - {len(channel.get('videos', []))} videos")

    return channels_data

if __name__ == "__main__":
    data = seed_db_channels()
