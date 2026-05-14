@echo off
echo 차 태권도 사이트 서버를 시작합니다...
echo.
echo 서버가 시작되면 브라우저에서 아래 주소로 접속하세요:
echo http://localhost:3000
echo.
echo 서버를 종료하려면 이 창을 닫으세요.
echo.
cd /d "%~dp0"
npx serve . --port 3000
pause
