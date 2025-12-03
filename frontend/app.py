import streamlit as st
import requests
import time
from PIL import Image
from io import BytesIO
import base64

# Backend URL
BACKEND_URL = "http://backend:3000"

st.set_page_config(page_title="WhatsApp Automation", page_icon="🤖", layout="wide")

st.title("🤖 WhatsApp Automation Dashboard")

# Sidebar - Status & QR
st.sidebar.header("Connection Status")

def get_status():
    try:
        response = requests.get(f"{BACKEND_URL}/status")
        if response.status_code == 200:
            return response.json()
    except requests.exceptions.ConnectionError:
        return None
    return None

status_data = get_status()

if status_data:
    st.sidebar.write(f"**Status:** {status_data.get('status')}")
    if status_data.get('ready'):
        st.sidebar.success("Connected")
    else:
        st.sidebar.warning("Not Connected")
        
        # Fetch QR if not ready
        if status_data.get('status') == 'Scan QR Code':
            try:
                qr_response = requests.get(f"{BACKEND_URL}/qr")
                if qr_response.status_code == 200:
                    qr_data = qr_response.json().get('qr')
                    if qr_data:
                        # Display QR
                        # qr_data is a data URL: data:image/png;base64,...
                        st.sidebar.image(qr_data, caption="Scan with WhatsApp")
            except:
                pass
else:
    st.sidebar.error("Backend Offline")

if st.sidebar.button("Refresh Status"):
    st.rerun()

# Main Content
st.header("Configuration")

# Initialize session state for groups if not present
if 'groups' not in st.session_state:
    st.session_state.groups = []

# Fetch Data (Outside Form)
current_config = {}
try:
    config_response = requests.get(f"{BACKEND_URL}/config", timeout=2)
    if config_response.status_code == 200:
        current_config = config_response.json()
except Exception as e:
    st.error(f"Failed to load config: {e}")

# Fetch Groups (Outside Form)
try:
    groups_response = requests.get(f"{BACKEND_URL}/groups", timeout=2)
    if groups_response.status_code == 200:
        fetched_groups = groups_response.json()
        if fetched_groups:
            st.session_state.groups = fetched_groups
            # Update options map
except Exception as e:
    # Don't show error immediately, just use cached if available
    pass

# Use groups from session state
groups = st.session_state.groups
group_options = {g['name']: g['id'] for g in groups}

if not groups:
    st.warning("No groups found yet. Please wait for WhatsApp to sync and click 'Refresh Status' in the sidebar.")

# Form
with st.form("config_form"):
    st.subheader("General Settings")
    confirmation_number = st.text_input("Confirmation Phone Number (for approval)", value=current_config.get('confirmationNumber', ''))

    st.subheader("Schedule (Israel Time)")
    col1, col2, col3 = st.columns(3)
    
    with col1:
        sun_thu_time = st.text_input("Sunday - Thursday", value=current_config.get('schedules', {}).get('sun_thu', '08:00'))
    with col2:
        fri_time = st.text_input("Friday", value=current_config.get('schedules', {}).get('fri', '08:00'))
    with col3:
        sat_time = st.text_input("Saturday", value=current_config.get('schedules', {}).get('sat', '20:00'))

    st.subheader("Content")
    message_text = st.text_area("Message Text", value=current_config.get('message', ''), height=150)
    
    uploaded_file = st.file_uploader("Upload Image (Optional)", type=['png', 'jpg', 'jpeg'])
    
    st.subheader("Target Groups")
    
    # Pre-select existing
    default_groups = []
    if 'targetGroups' in current_config:
        for gid in current_config['targetGroups']:
            # Find name for gid in current options
            name = next((name for name, id in group_options.items() if id == gid), None)
            if name:
                default_groups.append(name)
            else:
                # If group is in config but not in current fetch, maybe keep it? 
                # For now, let's just show what we can find.
                pass

    selected_group_names = st.multiselect("Select Groups", options=list(group_options.keys()), default=default_groups)

    # Submit Button MUST be inside the form
    submitted = st.form_submit_button("Save Configuration", type="primary")

    if submitted:
        # Prepare data
        new_config = {
            "schedules": {
                "sun_thu": sun_thu_time,
                "fri": fri_time,
                "sat": sat_time
            },
            "message": message_text,
            "targetGroups": [group_options[name] for name in selected_group_names],
            "confirmationNumber": confirmation_number
        }
        
        # Send to backend
        files = {}
        if uploaded_file:
            files = {'image': (uploaded_file.name, uploaded_file, uploaded_file.type)}
        
        try:
            import json
            payload = {"data": json.dumps(new_config)}
            
            save_response = requests.post(
                f"{BACKEND_URL}/config",
                data=payload,
                files=files if uploaded_file else None
            )

            if save_response.status_code == 200:
                st.success("Configuration saved successfully!")
                time.sleep(1)
                st.rerun()
            else:
                st.error("Failed to save configuration")
        except Exception as e:
            st.error(f"Error saving: {e}")

st.markdown("---")
st.subheader("Manual Actions")
st.info("Use this button to test the broadcast immediately with the CURRENT saved configuration.")
if st.button("Trigger Broadcast Now (Test)"):
    try:
        res = requests.post(f"{BACKEND_URL}/broadcast")
        if res.status_code == 200:
            st.success("Broadcast triggered!")
        else:
            st.error(f"Failed: {res.text}")
    except Exception as e:
        st.error(f"Error: {e}")
