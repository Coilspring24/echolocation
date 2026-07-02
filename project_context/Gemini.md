# Project: Context-Aware Room Authentication (Audio Challenge/Response)

## 1. System Objective
A highly scalable, on-demand physical security bridge. The system verifies a user's presence in a specific room by emitting a one-time, audible high-frequency cryptographic sequence from a physical speaker, which is captured and decoded by the user's mobile web browser.

## 2. Hardware Architecture (The Emitter)
*   **Controller:** ESP32-C3 Mini v1 (Single-core RISC-V).
*   **Amplifier:** DFRobot MAX98357A I2S Class D Amp (SKU: DFR0954).
*   **Speaker:** DFRobot 2.5W 8-Ohm Enclosed Speaker (with JST PH2.0 connector).
*   **Power Delivery:** 5V logic via USB to maximize amp output (yields ~1.8W of clean audio into the 8-ohm load).

### 2.1. Exact Wiring Map
| DFRobot MAX98357A | ESP32-C3 Mini | Notes |
| :--- | :--- | :--- |
| **VCC** | **5V (VBUS)** | Must be 5V for maximum volume. |
| **GND** | **GND** | Common Ground. |
| **BCLK** | **GPIO 4** | Bit Clock. |
| **LRC** | **GPIO 5** | Left/Right Word Select. |
| **DIN** | **GPIO 6** | Digital Audio In. |
| **SD** | **[Disconnected]** | Floating pin defaults to mixed Mono output. |
| **PH2.0 Port** | **Speaker Plug** | Direct snap-in connection (No soldering). |

*Hardware Constraint:* Because the C3 is single-core, I2S audio generation must use DMA (Direct Memory Access) buffers to prevent Wi-Fi interrupts from causing audio stutter during the chirp sequence.

## 3. The Audio Protocol
The ESP32 synthesizes pure sine waves. To bypass smartphone OS voice filters while remaining easy for the phone's microphone to detect, the frequencies are kept in the highly efficient 1kHz to 4kHz range.

*   **Sync Tone:** 1000 Hz for 500ms (Triggers the frontend FFT timer).
*   **Data Tones:** 220ms duration per digit, followed by 50ms of silence.
*   **Digit Mapping:**
    *   Digit `0` = 1500 Hz
    *   Digit `1` = 1800 Hz
    *   Digit `2` = 2100 Hz
    *   ... incrementing by 300 Hz per digit.

## 4. Backend (The Gatekeeper)
*   **Stack:** Node.js / Python with Redis and MQTT.
*   **Flow:**
    1.  Frontend hits `POST /challenge/request`.
    2.  Backend generates a random numeric nonce.
    3.  Backend stores `challenge:{nonce}` -> `{session_id}` in Redis with a strict 10-second TTL.
    4.  Backend publishes the nonce via MQTT to `room_a/challenge`.
    5.  Frontend hits `POST /challenge/verify` with the decoded nonce.
    6.  Backend performs an atomic **check-and-burn** in Redis. If successful, creates `verified:{session_id}` -> `true` with a 45-minute TTL.

## 5. Frontend (The Web App)
*   **Constraint:** Must run in standard mobile browsers (Chrome/Safari) without native apps.
*   **Audio Pipeline:** Uses the `Web Audio API`. Must request the microphone with `echoCancellation: false` and `noiseSuppression: false` to prevent the OS from erasing the sine waves.
*   **DSP Engine:** Uses an `AnalyserNode` to perform a Fast Fourier Transform (FFT). Uses `requestAnimationFrame` to continuously poll the frequency bins. Upon detecting the 1000Hz Sync Tone, it triggers a timer to read the dominant frequency bin every 270ms to decode the subsequent digits.
