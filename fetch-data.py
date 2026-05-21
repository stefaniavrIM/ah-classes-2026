#!/usr/bin/env python3
"""
A&H Classes 2026-2027 - Data Fetcher
Pulls data from Google Sheets and saves as data/data.json.
Also downloads course tile images from Google Drive into data/images/.

Usage:
  python3 fetch-data.py
"""

import json
import os
import re
import requests
from google.oauth2 import service_account
from googleapiclient.discovery import build

SERVICE_ACCOUNT_KEY = 'service-account-key.json'
SPREADSHEET_ID = '1gnLadpp6a3SldQm9ryK8znogvS2c1iLhYe5wivqIt44'

# This matches your current Projects tab layout:
# A Order, B Class Code, C Class Title, D Short blurb, E Full Description,
# F Professor Name, G Majors, H Concept Tags, I Semester Offered, J Credits,
# K Past Student Work, L Video Link, M Tile image, N Status
RANGES = [
    'Projects!A1:N',
    'Videos!A1:E',
    'Recorded Events!A1:E',
    'Archival Book!A1:F',
    'Live Events!A1:G',
]

DATA_DIR = 'data'
DATA_FILE = os.path.join(DATA_DIR, 'data.json')
IMAGES_DIR = os.path.join(DATA_DIR, 'images')


def get_sheets_service():
    credentials = service_account.Credentials.from_service_account_file(
        SERVICE_ACCOUNT_KEY,
        scopes=['https://www.googleapis.com/auth/spreadsheets.readonly']
    )
    return build('sheets', 'v4', credentials=credentials)


def fetch_data(service):
    return service.spreadsheets().values().batchGet(
        spreadsheetId=SPREADSHEET_ID,
        ranges=RANGES
    ).execute()


def looks_like_instruction_row(row):
    """Skip row 2 only if it is clearly an instruction row, not real data."""
    joined = ' '.join(str(cell).lower() for cell in row if cell is not None)
    instruction_markers = [
        'display order', 'comma-separated', 'auto-filled', 'do not edit',
        'youtube/vimeo embed', 'recording url', 'add image here'
    ]
    return any(marker in joined for marker in instruction_markers)


def strip_instruction_rows_only_when_present(data):
    for value_range in data.get('valueRanges', []):
        values = value_range.get('values', [])
        if len(values) > 1 and looks_like_instruction_row(values[1]):
            value_range['values'] = [values[0]] + values[2:]
    return data


def normalize_header(value):
    return re.sub(r'[^a-z0-9]+', '', str(value or '').strip().lower())


def find_col(headers, possible_names):
    normalized = [normalize_header(h) for h in headers]
    for name in possible_names:
        target = normalize_header(name)
        if target in normalized:
            return normalized.index(target)
    return None


def cell(row, index):
    if index is None or index >= len(row):
        return ''
    return str(row[index]).strip()


def safe_filename(value):
    value = str(value or '').strip()
    value = re.sub(r'[^a-zA-Z0-9_-]+', '_', value)
    value = value.strip('_')
    return value or 'course'


def extract_drive_file_id(url):
    if not url:
        return None
    patterns = [
        r'id=([a-zA-Z0-9_-]{20,})',
        r'/d/([a-zA-Z0-9_-]{20,})',
    ]
    for pattern in patterns:
        match = re.search(pattern, url)
        if match:
            return match.group(1)
    return None


def is_google_drive_url(url):
    return 'drive.google.com' in str(url).lower()


def download_from_gdrive(url, local_path):
    file_id = extract_drive_file_id(url)
    if not file_id:
        print(f'  Skipping non-Drive image link: {url}')
        return False

    folder = os.path.dirname(local_path)
    if folder:
        os.makedirs(folder, exist_ok=True)

    download_url = f'https://drive.google.com/uc?export=download&id={file_id}&confirm=t'
    session = requests.Session()
    response = session.get(download_url, stream=True, timeout=30)

    content_type = response.headers.get('Content-Type', '').lower()
    if 'html' in content_type:
        print(f'  Got HTML instead of image for {local_path}. Check Drive sharing permissions.')
        return False

    if response.status_code >= 400:
        print(f'  HTTP {response.status_code} for {local_path}')
        return False

    with open(local_path, 'wb') as f:
        for chunk in response.iter_content(32768):
            if chunk:
                f.write(chunk)

    return os.path.getsize(local_path) > 0


def download_images(data):
    """Download images and replace Drive URLs in the data with local paths."""
    os.makedirs(IMAGES_DIR, exist_ok=True)

    for value_range in data.get('valueRanges', []):
        range_name = value_range.get('range', '')
        values = value_range.get('values', [])
        if len(values) < 2:
            continue

        headers = values[0]

        if 'Projects' in range_name:
            order_col = find_col(headers, ['Order'])
            code_col = find_col(headers, ['Class Code'])
            title_col = find_col(headers, ['Class Title', 'Class title', 'Title'])
            image_col = find_col(headers, ['Tile image', 'Tile Image', 'Image Link'])

            if image_col is None:
                print('  No Tile image column found in Projects.')
                continue

            for row_number, row in enumerate(values[1:], start=2):
                image_url = cell(row, image_col)
                if not image_url or not is_google_drive_url(image_url):
                    continue

                order = safe_filename(cell(row, order_col))
                code = safe_filename(cell(row, code_col))
                title = safe_filename(cell(row, title_col))
                local_path = os.path.join(IMAGES_DIR, f'{row_number}_{order}_{code}_{title}.jpg')

                if os.path.exists(local_path) and os.path.getsize(local_path) > 0:
                    print(f'  Skipping {local_path} (already exists)')
                    row[image_col] = local_path
                    continue

                print(f'  Downloading {local_path}...')
                if download_from_gdrive(image_url, local_path):
                    row[image_col] = local_path
                else:
                    print(f'  Failed: {local_path}')

        elif 'Archival Book' in range_name or 'Book' in range_name:
            local_col = find_col(headers, ['Image Link'])
            remote_col = find_col(headers, ['Image Link (Converted Google Drive)', 'Image Link (Original Google Drive)'])
            if local_col is None or remote_col is None:
                continue

            for row in values[1:]:
                local_path = cell(row, local_col)
                remote_url = cell(row, remote_col)
                if not local_path or not remote_url or not is_google_drive_url(remote_url):
                    continue
                if os.path.exists(local_path):
                    print(f'  Skipping {local_path} (already exists)')
                    continue
                print(f'  Downloading {local_path}...')
                if not download_from_gdrive(remote_url, local_path):
                    print(f'  Failed: {local_path}')


def save_data(data):
    os.makedirs(DATA_DIR, exist_ok=True)
    with open(DATA_FILE, 'w') as f:
        json.dump(data, f, indent=2)
    print(f'  Saved {DATA_FILE}')


def main():
    print('A&H Classes 2026-2027 - Data Fetcher')
    print('=' * 44)

    if not os.path.exists(SERVICE_ACCOUNT_KEY):
        print(f'\nERROR: {SERVICE_ACCOUNT_KEY} not found.')
        print('Put your Google service account JSON key in this folder.')
        return

    if SPREADSHEET_ID == 'YOUR_SPREADSHEET_ID_HERE':
        print('\nERROR: SPREADSHEET_ID not set.')
        return

    print('\n1. Connecting to Google Sheets API...')
    service = get_sheets_service()

    print('2. Fetching spreadsheet data...')
    data = fetch_data(service)
    data = strip_instruction_rows_only_when_present(data)

    for vr in data.get('valueRanges', []):
        row_count = max(0, len(vr.get('values', [])) - 1)
        print(f'   {vr.get("range", "Unknown range")}: {row_count} entries')

    print('\n3. Downloading images...')
    download_images(data)

    print('\n4. Saving data.json...')
    save_data(data)

    print('\nDone! Your site data is up to date.')


if __name__ == '__main__':
    main()
