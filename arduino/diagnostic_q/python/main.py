import time
from arduino.app_utils import App, Bridge

def on_diag(n, a0, a1, b2, b3, b4, b5, b6, b7, b8):
    print(f"#{n}  A0={a0}  A1={a1}  b={b2}{b3}{b4}{b5}{b6}{b7}{b8}", flush=True)

Bridge.provide("diag", on_diag)

def loop():
    time.sleep(1)

if __name__ == "__main__":
    App.run(user_loop=loop)
