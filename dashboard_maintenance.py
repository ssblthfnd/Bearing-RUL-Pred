# INI ADALAH FILE REFERENCE UNTUK PENELITIAN ANDA
# Anda dapat menjalankan file ini secara lokal menggunakan:
# streamlit run dashboard_maintenance.py

import streamlit as st
import pandas as pd
import numpy as np
from sklearn.linear_model import LinearRegression
from sklearn.metrics import mean_squared_error
import plotly.graph_objects as go
from datetime import datetime, timedelta
import google.generativeai as genai
import io

# ==========================================
# CONFIGURATION & HEADER
# ==========================================
st.set_page_config(page_title="Smart Predictive Maintenance", layout="wide")

st.title("🛠️ Smart Predictive Maintenance Dashboard")
st.markdown("""
Aplikasi ini melakukan analisis vibrasi bearing, estimasi **Health Indicator (HI)**, 
dan prediksi **Remaining Useful Life (RUL)** menggunakan degradasi eksponensial.
""")

# ==========================================
# 1. DATA TEMPLATE GENERATOR
# ==========================================
def generate_template():
    df_template = pd.DataFrame({
        'Point': ['AH', 'AV', 'AA', 'BH', 'BV', 'BA'],
        'Date': ['18-Jan-21', '18-Jan-21', '18-Jan-21', '18-Jan-21', '18-Jan-21', '18-Jan-21'],
        'Time': ['10:18', '10:20', '10:22', '10:24', '10:26', '10:28'],
        'Level': [0.88, 0.92, 0.85, 1.20, 1.15, 1.10],
        'Spectral': ['Vel', 'Vel', 'Vel', 'Vel', 'Vel', 'Vel']
    })
    return df_template.to_csv(index=False).encode('utf-8')

# ==========================================
# 2. DATA PREPROCESSING (MATLAB CONVERSION)
# ==========================================
def preprocess_data(df, point_prefix):
    # Logika MATLAB: removevars(data, 'Spectral')
    df = df.drop(columns=['Spectral'], errors='ignore')
    
    # Logika MATLAB: Filter data berdasarkan kategori bearing (A, B, C, D)
    df = df[df['Point'].str.startswith(point_prefix)].copy()
    
    # Logika MATLAB: Gabungkan Date & Time dan ubah ke numerik
    df['Datetime'] = pd.to_datetime(df['Date'] + ' ' + df['Time'], dayfirst=True)
    df = df.sort_values('Datetime')
    
    # Numerik time (dalam hari) untuk regresi
    reference_date = df['Datetime'].min()
    df['Time_Numeric'] = (df['Datetime'] - reference_date).dt.total_seconds() / (24 * 3600)
    
    # Logika MATLAB: movmean dengan N=5
    df['Smoothed_Level'] = df['Level'].rolling(window=5, center=True).mean().fillna(method='bfill').fillna(method='ffill')
    
    return df

# ==========================================
# 3. MODELING (HI & RUL PREDICTION)
# ==========================================
def train_predictive_model(df, threshold):
    split_idx = int(len(df) * 0.8)
    train_df = df.iloc[:split_idx]
    test_df = df.iloc[split_idx:]
    
    # --- Linear Regression untuk Health Indicator (HI) ---
    X_train = train_df[['Time_Numeric']].values
    y_train = train_df['Smoothed_Level'].values
    X_test = test_df[['Time_Numeric']].values
    y_test = test_df['Smoothed_Level'].values
    
    model_hi = LinearRegression()
    model_hi.fit(X_train, y_train)
    
    y_pred = model_hi.predict(X_test)
    rmse = np.sqrt(mean_squared_error(y_test, y_pred))
    
    # --- Exponential Degradation Model Fitting ---
    y_train_log = np.log(y_train + 1e-9)
    coeffs = np.polyfit(X_train.flatten(), y_train_log, 1)
    slope = coeffs[0]
    intercept = coeffs[1]
    
    # Formula requested: RUL = abs(intercept / slope)
    rul_days = abs(intercept / (slope if slope != 0 else 1e-9))
    
    last_date = df['Datetime'].max()
    predicted_failure_date = last_date + timedelta(days=rul_days)
    
    return {
        "rmse": rmse,
        "rul_days": rul_days,
        "failure_date": predicted_failure_date,
        "y_pred": y_pred,
        "test_df": test_df,
        "slope": slope,
        "intercept": intercept
    }

# ==========================================
# 4. UI (STREAMLIT)
# ==========================================
# Sidebar... (implementasi dilanjutkan di file dashboard_maintenance.py)
# ...
