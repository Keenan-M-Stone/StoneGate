#!/usr/bin/env python3
"""
Minimal QEC service stub for StoneGate backend.
Accepts POST /api/qec/submit, GET /api/qec/status/<job_id>, GET /api/qec/result/<job_id>
Implements job queue and returns dummy corrections.
"""
from flask import Flask, request, jsonify
import threading
import time
import uuid
import json as pyjson
import os

app = Flask(__name__)
jobs = {}
BASE_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', 'shared', 'protocol'))
PARTS_FILE = os.path.join(BASE_DIR, 'PartsLibrary.json')
USER_PARTS_FILE = os.path.join(BASE_DIR, 'user_parts.json')
OVERRIDES_FILE = os.path.join(BASE_DIR, 'device_overrides.json')

# load strings and errors from shared config
CONFIG_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', 'shared', 'config'))
STRINGS = {}
ERRORS = {}
try:
    with open(os.path.join(CONFIG_DIR, 'strings.json'), 'r') as sf:
        STRINGS = pyjson.load(sf)
except Exception:
    STRINGS = {}
try:
    with open(os.path.join(CONFIG_DIR, 'errors.json'), 'r') as ef:
        ERRORS = pyjson.load(ef)
except Exception:
    ERRORS = {}

# optional validation library
try:
    import jsonschema
    JSONSCHEMA_AVAILABLE = True
except Exception:
    JSONSCHEMA_AVAILABLE = False

def load_parts():
    parts = {}
    try:
        with open(PARTS_FILE, 'r') as f:
            parts = pyjson.load(f)
    except Exception:
        parts = {}
    # merge user parts, override defaults
    try:
        with open(USER_PARTS_FILE, 'r') as uf:
            user = pyjson.load(uf)
            for k, v in user.items():
                parts[k] = v
    except Exception:
        pass
    return parts

def save_user_part(name, spec):
    user = {}
    try:
        if os.path.exists(USER_PARTS_FILE):
            with open(USER_PARTS_FILE, 'r') as uf:
                user = pyjson.load(uf)
    except Exception:
        user = {}
    user[name] = spec
    with open(USER_PARTS_FILE, 'w') as uf:
        pyjson.dump(user, uf, indent=2)

def delete_user_part(name):
    try:
        if os.path.exists(USER_PARTS_FILE):
            with open(USER_PARTS_FILE, 'r') as uf:
                user = pyjson.load(uf)
            if name in user:
                del user[name]
                with open(USER_PARTS_FILE, 'w') as uf:
                    pyjson.dump(user, uf, indent=2)
                return True
    except Exception:
        pass
    return False


def load_device_overrides():
    try:
        with open(OVERRIDES_FILE, 'r') as f:
            return pyjson.load(f)
    except Exception:
        return {}


def save_device_override(device_id, override):
    overrides = {}
    try:
        if os.path.exists(OVERRIDES_FILE):
            with open(OVERRIDES_FILE, 'r') as f:
                overrides = pyjson.load(f)
    except Exception:
        overrides = {}
    overrides[device_id] = override
    with open(OVERRIDES_FILE, 'w') as f:
        pyjson.dump(overrides, f, indent=2)


def delete_device_override(device_id):
    try:
        if os.path.exists(OVERRIDES_FILE):
            with open(OVERRIDES_FILE, 'r') as f:
                overrides = pyjson.load(f)
            if device_id in overrides:
                del overrides[device_id]
                with open(OVERRIDES_FILE, 'w') as f:
                    pyjson.dump(overrides, f, indent=2)
                return True
    except Exception:
        pass
    return False

@app.route('/api/qec/submit', methods=['POST'])
def submit():
    data = request.get_json(force=True)
    job_id = data.get('job_id') or str(uuid.uuid4())
    jobs[job_id] = {'status': 'queued', 'result': None, 'progress': 0.0}
    # Start background job
    threading.Thread(target=run_job, args=(job_id, data), daemon=True).start()
    return jsonify({'job_id': job_id, 'status': STRINGS.get('qec', {}).get('queued', 'queued')})

def run_job(job_id, data):
    jobs[job_id]['status'] = 'running'
    for i in range(5):
        time.sleep(0.2)
        jobs[job_id]['progress'] = (i+1)/5
    # Dummy correction: flip all syndrome bits
    corrections = []
    for m in data.get('measurements', []):
        corrections.append({'qubit': m['qubit'], 'round': m['round'], 'correction': 1-m['value']})
    jobs[job_id]['result'] = {
        'job_id': job_id,
        'status': 'done',
        'corrections': corrections,
        'statistics': {'dummy': True},
        'raw_decision': None
    }
    jobs[job_id]['status'] = 'done'
    jobs[job_id]['progress'] = 1.0

@app.route('/api/qec/status/<job_id>', methods=['GET'])
def status(job_id):
    job = jobs.get(job_id)
    if not job:
        return jsonify({'error': 'not found'}), 404
    return jsonify({'job_id': job_id, 'status': job['status'], 'progress': job.get('progress', 0.0)})

@app.route('/api/qec/result/<job_id>', methods=['GET'])
def result(job_id):
    job = jobs.get(job_id)
    if not job or not job['result']:
        return jsonify({'error': 'not ready'}), 404
    return jsonify(job['result'])


# Parts management API
@app.route('/api/parts', methods=['GET'])
def list_parts():
    parts = load_parts()
    return jsonify(parts)


@app.route('/api/parts/save', methods=['POST'])
def save_part():
    data = request.get_json(force=True)
    name = data.get('name')
    spec = data.get('spec')
    if not name or not spec:
        return jsonify({'error': STRINGS.get('parts', {}).get('name_and_spec_required', 'name and spec required')}), 400
    # prevent overwriting default parts: if name exists in builtin PartsLibrary, require save_as_new flag
    try:
        with open(PARTS_FILE, 'r') as f:
            builtin = pyjson.load(f)
    except Exception:
        builtin = {}
    if name in builtin and not data.get('save_as_new'):
        return jsonify({'error': STRINGS.get('parts', {}).get('cannot_overwrite_builtin', 'cannot overwrite builtin part; set save_as_new and provide new_name')}), 400
    # if save_as_new requested and new_name provided, use that
    if data.get('save_as_new'):
        new_name = data.get('new_name')
        if not new_name:
            return jsonify({'error': STRINGS.get('parts', {}).get('new_name_required', 'new_name required when save_as_new is true')}), 400
        name = new_name
    save_user_part(name, spec)
    return jsonify({'status': STRINGS.get('parts', {}).get('saved', 'saved'), 'name': name})


@app.route('/api/parts/reset', methods=['POST'])
def reset_part():
    data = request.get_json(force=True)
    name = data.get('name')
    if not name:
        return jsonify({'error': STRINGS.get('parts', {}).get('name_and_spec_required', 'name required')}), 400
    # only remove from user parts; cannot delete builtin via API
    ok = delete_user_part(name)
    if ok:
        return jsonify({'status': STRINGS.get('parts', {}).get('deleted', 'deleted'), 'name': name})
    return jsonify({'error': STRINGS.get('parts', {}).get('not_found', 'not found in user parts')}), 404


# Device overrides API
@app.route('/api/device_overrides', methods=['GET'])
def list_device_overrides():
    overrides = load_device_overrides()
    return jsonify(overrides)


@app.route('/api/device_overrides/save', methods=['POST'])
def save_device_override_route():
    data = request.get_json(force=True)
    device_id = data.get('device_id')
    override = data.get('override')
    if not device_id or override is None:
        return jsonify({'error': STRINGS.get('overrides', {}).get('device_and_override_required', 'device_id and override required')}), 400
    # optional validation
    if JSONSCHEMA_AVAILABLE:
        # simple schema: override must be an object
        try:
            jsonschema.validate(override, {"type": "object"})
        except Exception as e:
            return jsonify({'error': STRINGS.get('overrides', {}).get('validation_failed', 'validation failed'), 'detail': str(e)}), 400
    save_device_override(device_id, override)
    return jsonify({'status': STRINGS.get('overrides', {}).get('saved', 'saved'), 'device_id': device_id})


@app.route('/api/device_overrides/reset', methods=['POST'])
def reset_device_override_route():
    data = request.get_json(force=True)
    device_id = data.get('device_id')
    if not device_id:
        return jsonify({'error': STRINGS.get('overrides', {}).get('device_and_override_required', 'device_id required')}), 400
    ok = delete_device_override(device_id)
    if ok:
        return jsonify({'status': STRINGS.get('overrides', {}).get('deleted', 'deleted'), 'device_id': device_id})
    return jsonify({'error': STRINGS.get('overrides', {}).get('not_found', 'not found')}), 404


@app.route('/api/device_overrides/reload', methods=['POST'])
def reload_device_overrides_route():
    """Touch or update the overrides file mtime so an external watcher (C++ backend) will reload it.
    This is useful when the file hasn't changed but you want the backend to re-read it (for example after manual edits).
    """
    try:
        # ensure file exists
        if not os.path.exists(OVERRIDES_FILE):
            # create an empty overrides file
            with open(OVERRIDES_FILE, 'w') as f:
                pyjson.dump({}, f, indent=2)
        # touch the file (update mtime)
        now = time.time()
        os.utime(OVERRIDES_FILE, (now, now))
        return jsonify({'status': STRINGS.get('overrides', {}).get('touched', 'touched'), 'path': OVERRIDES_FILE})
    except Exception as e:
        return jsonify({'error': STRINGS.get('overrides', {}).get('failed', 'failed'), 'detail': str(e)}), 500

if __name__ == '__main__':
    app.run(port=5001, debug=True)
