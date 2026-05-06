// script.js 내의 drawChart 함수 수정
function drawChart(chartData, ticker, period) {
    // 1. 일봉 캔들차트
    const traceCandle = {
        x: chartData.daily.dates,
        open: chartData.daily.open, high: chartData.daily.high, 
        low: chartData.daily.low, close: chartData.daily.close,
        type: 'candlestick',
        name: '일봉 주가',
        opacity: 0.4,
        increasing: {line: {color: '#ff9999'}, fillcolor: '#ff9999'},
        decreasing: {line: {color: '#99ccff'}, fillcolor: '#99ccff'}
    };

    // 2. 시간봉 라인차트
    const traceHourlyLine = {
        x: chartData.hourly.dates,
        y: chartData.hourly.close,
        type: 'scatter',
        mode: 'lines',
        name: '실시간 흐름(1H)',
        line: { color: '#333333', width: 2 }, 
    };

    const traceUpper = {
        x: chartData.hourly.dates, 
        y: chartData.hourly.upper,
        type: 'scatter', mode: 'lines',
        name: '🛑 매도 상한선',
        line: { color: '#e74c3c', width: 2 }
    };

    const traceLower = {
        x: chartData.hourly.dates, 
        y: chartData.hourly.lower,
        type: 'scatter', mode: 'lines',
        name: '✅ 매수 하한선',
        line: { color: '#3498db', width: 2 }
    };
    
    // --- traceEMA 정의 부분 삭제됨 ---

    const layout = {
        title: `<b>${ticker}</b>`, // 모바일에서는 제목을 간결하게
        xaxis: { type: 'date', rangeslider: { visible: false } },
        yaxis: { title: 'Price', side: 'right', fixedrange: false },
        autosize: true, // 자동으로 크기 조절
        height: window.innerWidth < 768 ? 450 : 650, // 모바일에서는 높이를 낮춤
        margin: { 
            t: 40, 
            l: 10, 
            r: 40, 
            b: 40 
        },
        hovermode: 'x unified',
        legend: { 
            orientation: 'h', 
            y: -0.2,
            x: 0,
            font: { size: 10 } // 모바일에서 레전드 글자 크기 축소
        },
        plot_bgcolor: '#fcfcfc'
    };

    // 반응형 옵션 추가
    const config = {
        responsive: true,
        displayModeBar: false // 모바일에서는 상단 도구바가 거슬리므로 숨김
    };

    Plotly.newPlot('chart', [traceUpper, traceLower, traceCandle, traceHourlyLine], layout, config);
}
// 데이터 가져오기 함수
async function fetchData() {
    const tickerInput = document.getElementById('ticker');
    const periodInput = document.getElementById('period');
    
    const rawTicker = tickerInput.value.trim();
    const period = periodInput.value || 20;
    
    if(!rawTicker) { alert("종목을 선택하거나 입력해주세요!"); return; }

    const loading = document.getElementById('loading');
    const chartDiv = document.getElementById('chart');

    if(loading) loading.style.display = 'block';
    if(chartDiv) chartDiv.style.opacity = '0.3';

    try {
        const response = await fetch(`/api/data?ticker=${encodeURIComponent(rawTicker)}&period=${period}`);
        const data = await response.json();

        if (data.error) {
            alert(data.error);
        } else {
            // [중요] 백엔드 리턴 구조에 맞춰 전달
            // 만약 백엔드가 { chart_data: { daily:..., hourly:... }, ticker:..., news:... } 형태로 주면:
            drawChart(data.chart_data, data.ticker, period);
            updateTrendMessage(data.ticker, period, data.chart_data.trend_slope);
            
            // 뉴스 업데이트 호출 (이게 빠져있었습니다!)
        }
    } catch (error) {
        console.error('Error:', error);
        alert('서버 통신 오류가 발생했습니다.');
    } finally {
        if(loading) loading.style.display = 'none';
        if(chartDiv) chartDiv.style.opacity = '1';
    }
}

// 나머지 함수들 (loadTickers, updateNews, updateTrendMessage 등)은 기존과 동일
// ... (생략)


document.addEventListener("DOMContentLoaded", async function() {
    // 1. 종목 리스트 먼저 불러오기
    await loadTickers();
    
    // 2. 검색 버튼 이벤트
    document.getElementById('search-btn').addEventListener('click', fetchData);
    
    // 3. 엔터키 입력 시 검색 가능하게 추가 (선택사항)
    document.getElementById('ticker').addEventListener('keypress', function(e) {
        if (e.key === 'Enter') fetchData();
    });
});

async function loadTickers() {
    try {
        const response = await fetch('/api/tickers');
        const data = await response.json();
        const datalist = document.getElementById('ticker-list');
        
        if (!datalist) {
            console.error("HTML에 'ticker-list' 아이디를 가진 datalist가 없습니다.");
            return;
        }

        if (data.tickers) {
            datalist.innerHTML = ''; // 초기화
            data.tickers.forEach(t => {
                const option = document.createElement('option');
                option.value = `${t.symbol} - ${t.name}`;
                datalist.appendChild(option);
            });
            console.log("종목 로딩 완료:", data.tickers.length, "개");
        }
    } catch (error) {
        console.error("종목 리스트 로딩 실패:", error);
    }
}

function updateTrendMessage(ticker, period, slope) {
    const resultDiv = document.getElementById('analysis-result');
    const textSpan = document.getElementById('trend-text');
    
    if (!resultDiv || !textSpan) return;

    // 기울기 절대값 계산 및 상승/하락 판별
    const absSlope = Math.abs(slope).toFixed(2); // 소수점 2자리까지
    const direction = slope >= 0 ? "상승" : "하락";
    const color = slope >= 0 ? "#e74c3c" : "#3498db"; // 상승은 빨강, 하락은 파랑

    // 문구 구성
    textSpan.innerHTML = `이 종목은 최근 <strong>${period}일</strong> 동안 하루 평균 <strong>$${absSlope}</strong>만큼 <strong style="color:${color}">${direction}</strong>하고 있습니다.`;
    
    // 결과창 보여주기
    resultDiv.style.display = 'flex';
}

let favorites = {}; // 서버에서 가져온 관심종목 데이터 저장

// 서버에서 CSV 기반 관심종목 로드
async function loadFavorites() {
    try {
        const res = await fetch('/api/favorites');
        favorites = await res.json();
        renderFavorites();
    } catch (e) {
        console.error("관심종목 로드 실패", e);
    }
}

// 화면에 그룹 및 티커 그리기
function renderFavorites() {
    const container = document.getElementById('fav-groups-container');
    if(!container) return;
    container.innerHTML = '';

    for (const [groupName, tickers] of Object.entries(favorites)) {
        const groupDiv = document.createElement('div');
        groupDiv.className = 'group-card';
        
        let tagsHtml = tickers.map(t => `<span class="ticker-tag" onclick="quickSearch('${t}')">${t}</span>`).join('');
        
        groupDiv.innerHTML = `
            <div class="group-header">
                <span>📂 ${groupName}</span>
                <button class="del-btn" onclick="deleteGroup('${groupName}')" title="그룹 삭제">×</button>
            </div>
            <div class="ticker-tags">${tagsHtml || '<small style="color:#999">종목 없음</small>'}</div>
        `;
        container.appendChild(groupDiv);
    }
}

// 새 그룹 이름 생성
async function createNewGroup() {
    const name = prompt("새 그룹 이름을 입력하세요 (예: 반도체, 내주식):");
    if (!name) return;
    if (favorites[name]) { alert("이미 존재하는 그룹 이름입니다."); return; }
    
    favorites[name] = [];
    await saveFavorites();
}

// 현재 입력된 티커를 그룹에 추가
async function addCurrentTickerToGroup() {
    const tickerInput = document.getElementById('ticker').value;
    const ticker = tickerInput.split(" ")[0].toUpperCase().trim();
    
    if (!ticker) { alert("먼저 종목을 검색해주세요."); return; }

    const groupNames = Object.keys(favorites);
    if (groupNames.length === 0) {
        alert("먼저 '새 그룹 만들기'를 통해 그룹을 생성해주세요.");
        return;
    }

    const targetGroup = prompt(`어느 그룹에 추가할까요?\n[목록: ${groupNames.join(", ")}]`);
    
    if (targetGroup && favorites[targetGroup] !== undefined) {
        if (!favorites[targetGroup].includes(ticker)) {
            favorites[targetGroup].push(ticker);
            await saveFavorites();
            alert(`${targetGroup} 그룹에 ${ticker} 추가 완료!`);
        } else {
            alert("이미 그룹에 존재하는 종목입니다.");
        }
    } else if (targetGroup) {
        alert("존재하지 않는 그룹 이름입니다.");
    }
}

// 서버(CSV)에 저장요청
async function saveFavorites() {
    await fetch('/api/favorites', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(favorites)
    });
    renderFavorites();
}

// 그룹 삭제
async function deleteGroup(name) {
    if (confirm(`'${name}' 그룹과 포함된 모든 종목을 삭제하시겠습니까?`)) {
        delete favorites[name];
        await saveFavorites();
    }
}

// 태그 클릭 시 즉시 검색
function quickSearch(symbol) {
    document.getElementById('ticker').value = symbol;
    fetchData();
}

// 페이지 로드 시 실행
document.addEventListener("DOMContentLoaded", async function() {
    // ... 기존 loadTickers() 등 ...
    await loadFavorites();
    document.getElementById('add-fav-btn').addEventListener('click', addCurrentTickerToGroup);
});
