from fastapi import FastAPI, Query
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
import yfinance as yf
import pandas as pd
import numpy as np
import os
from pathlib import Path # <--- 추가: 경로를 안전하게 다루기 위한 라이브러리
import csv # 추가


# 현재 main.py 파일이 위치한 폴더의 절대 경로를 동적으로 계산
# Render 서버가 어떤 환경이든 무조건 앱의 최상단 폴더를 정확히 잡아냅니다.
# 파일 경로 설정

BASE_DIR = Path(__file__).resolve().parent
FAVORITES_FILE = BASE_DIR / "db" / "favorites.csv"



app = FastAPI(title="주식 박스권 분석 API")

# CSV 파일 초기화 (파일이 없으면 헤더만 포함해서 생성)
if not FAVORITES_FILE.exists():
    FAVORITES_FILE.parent.mkdir(parents=True, exist_ok=True)
    with open(FAVORITES_FILE, "w", encoding="utf-8", newline='') as f:
        writer = csv.writer(f)
        writer.writerow(["group_name", "ticker"])

# --- 관심 종목 API (CSV 기반) ---

@app.get("/api/favorites")
async def get_favorites():
    favs = {}
    if not FAVORITES_FILE.exists():
        return favs
    
    with open(FAVORITES_FILE, "r", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        for row in reader:
            group = row['group_name']
            ticker = row['ticker']
            if group not in favs:
                favs[group] = []
            if ticker: # 티커가 비어있지 않은 경우만 추가
                favs[group].append(ticker)
    return favs

@app.post("/api/favorites")
async def save_favorites(data: dict):
    # data 구조: {"그룹명": ["AAPL", "TSLA"], "빈그룹": []}
    try:
        with open(FAVORITES_FILE, "w", encoding="utf-8", newline='') as f:
            writer = csv.writer(f)
            writer.writerow(["group_name", "ticker"]) # 헤더
            
            for group_name, tickers in data.items():
                if not tickers: # 종목이 없는 빈 그룹인 경우
                    writer.writerow([group_name, ""])
                for ticker in tickers:
                    writer.writerow([group_name, ticker])
        return {"status": "success"}
    except Exception as e:
        return {"status": "error", "message": str(e)}


# 프론트엔드 연결
app.mount("/static", StaticFiles(directory="static"), name="static")

@app.get("/")
async def read_index():
    return FileResponse('static/index.html')

@app.get("/api/tickers")
async def get_top_us_tickers():
    try:
        # 동적으로 계산된 BASE_DIR을 기준으로 db 폴더 안의 csv 파일을 찾음
        # 윈도우(\)와 리눅스/Mac(/)의 슬래시 방향 차이도 알아서 완벽하게 처리해 줍니다.
        csv_path = BASE_DIR / "db" / "us_company.csv"
        print( csv_path)
        
        # 파일 존재 여부 확인 (pathlib의 exists() 사용)
        if not csv_path.exists():
            return {"tickers": [{"symbol": "AAPL", "name": "Apple Inc."}], "error": f"{csv_path} 파일을 찾을 수 없습니다."}
        
        # CSV 파일 읽기
        df = pd.read_csv(csv_path)

        # 상위 200개 추출
        top_df = df
        tickers_list = []
        for _, row in top_df.iterrows():
            symbol = str(row.get('Symbol', row.iloc[0])).replace('.', '-')
            name = str(row.get('Security', row.iloc[1]))
            tickers_list.append({"symbol": symbol, "name": name})
        print( tickers_list)
        return {"tickers": tickers_list}
        
    except Exception as e:
        return {"tickers": [{"symbol": "AAPL", "name": "Apple Inc."}], "error": f"CSV 로딩 에러: {str(e)}"}
# --- [기존과 동일] 주가 및 볼린저 밴드 계산 ---
import numpy as np
from scipy import stats # 추세선 계산을 위해 추가

@app.get("/api/data")
async def get_stock_data(ticker: str = Query(..., description="주식 종목코드"), 
                         period: int = Query(20, description="분석 기간")):
    try:
        clean_ticker = ticker.split(" ")[0].strip()
        stock = yf.Ticker(clean_ticker)
        
        # 1. 데이터 가져오기 (충분한 계산을 위해 6개월치 추천)
        df_hourly = stock.history(period="6mo", interval="1h")
        if df_hourly.empty:
            return {"error": "데이터를 찾을 수 없습니다."}

        # 2. 일 단위 리샘플링 (박스권 계산용)
        df_daily = df_hourly.resample('D').agg({
            'Open': 'first', 'High': 'max', 'Low': 'min', 'Close': 'last'
        }).dropna()

        # 3. [표준 수식 적용] 볼린저 밴드 계산 (SMA 사용)
        # 전문가 표준인 SMA(단순이동평균)로 변경하여 가독성 높임
        df_daily['MA'] = df_daily['Close'].rolling(window=period).mean()
        df_daily['STD'] = df_daily['Close'].rolling(window=period).std()
        
        # 밴드 계산 (MA 기준 상하 2표준편차)
        df_daily['Upper'] = df_daily['MA'] + (df_daily['STD'] * 2)
        df_daily['Lower'] = df_daily['MA'] - (df_daily['STD'] * 2)

        # 4. [핵심] 일일 데이터를 시간 데이터로 매핑 (시각적 왜곡 방지)
        # 시간 데이터의 '날짜'를 기준으로 그날의 일일 밴드값을 합칩니다.
        df_hourly['date_only'] = df_hourly.index.date
        df_daily['date_only'] = df_daily.index.date
        
        # Merge를 통해 시간 데이터 옆에 그날의 상/하한선을 붙임
        df_merged = df_hourly.reset_index().merge(
            df_daily[['date_only', 'Upper', 'Lower', 'MA']], 
            on='date_only', 
            how='left'
        ).set_index('Datetime')

        # 주말이나 공백 데이터 채우기
        df_merged[['Upper', 'Lower', 'MA']] = df_merged[['Upper', 'Lower', 'MA']].ffill()

        # 5. 추세 및 뉴스 생략 (기존과 동일)
        y_temp = df_daily['Close'].dropna().values[-min(len(df_daily), period):]
        slope, _, _, _, _ = stats.linregress(np.arange(len(y_temp)), y_temp)

        # 6. 데이터 정리 및 리턴
        df_merged = df_merged.replace({np.nan: None})
        df_daily = df_daily.replace({np.nan: None})


# main.py 내의 get_stock_data 함수 마지막 return 부분 수정

        return {
            "ticker": clean_ticker,
            "chart_data": {
                "hourly": {
                    "dates": df_merged.index.strftime('%Y-%m-%d %H:%M').tolist(),
                    "close": df_merged['Close'].tolist(),
                    "upper": df_merged['Upper'].tolist(),
                    "lower": df_merged['Lower'].tolist()
                    # "ma": df_merged['MA'].tolist()  <-- 이 줄 삭제 또는 주석 처리
                },
                "daily": {
                    "dates": df_daily.index.strftime('%Y-%m-%d').tolist(),
                    "open": df_daily['Open'].tolist(),
                    "high": df_daily['High'].tolist(),
                    "low": df_daily['Low'].tolist(),
                    "close": df_daily['Close'].tolist()
                },
                "trend_slope": slope
            }
        }

    except Exception as e:
        return {"error": str(e)}