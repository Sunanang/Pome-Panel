<div align="center">
  <img src="build/pome-panel-icon.png" width="88" alt="Pome Panel" />
  <h1>Pome Panel</h1>
  <p><strong>바로 펼치는 데스크톱 작업 공간.</strong></p>
  <p>할 일, 메모, 링크, 녹음과 AI 알림을 화면 가장자리에 두고 언제든 꺼내 쓰세요.</p>
  <p>
    <a href="https://github.com/Sunanang/Pome-Panel/releases">설치 받기</a> ·
    <a href="#시작하기">시작하기</a> ·
    <a href="docs/user-guide.en.md">사용 가이드</a> ·
    <a href="https://github.com/Sunanang/Pome-Panel/issues">문제 제보</a>
  </p>
  <p>
    <img src="https://img.shields.io/badge/macOS-13%2B%20Apple%20Silicon-111318?logo=apple" alt="macOS 13+ Apple Silicon" />
    <img src="https://img.shields.io/badge/Windows-10%2F11%20x64-0078D4" alt="Windows 10/11 x64" />
    <img src="https://img.shields.io/badge/License-MIT-35c58b" alt="MIT" />
  </p>
  <p>
    <a href="README.md">简体中文</a>
    ·
    <a href="README.zh-TW.md">繁體中文</a>
    ·
    <a href="README.en.md">English</a>
    ·
    <a href="README.ja.md">日本語</a>
    ·
    <strong>한국어</strong>
    ·
    <a href="README.es.md">Español</a>
    ·
    <a href="README.fr.md">Français</a>
    ·
    <a href="README.de.md">Deutsch</a>
    ·
    <a href="README.ru.md">Русский</a>
    ·
    <a href="README.pt-BR.md">Português (Brasil)</a>
  </p>
</div>

![Pome Panel 미리보기](docs/screenshots/workspace-overview.png)

<p align="center"><sub>캡슐을 눌러 펼치고, 접은 뒤 화면 네 가장자리로 끌어 고정하세요. 홈 위젯도 자유롭게 배치할 수 있습니다.</sub></p>

## 일상 업무를 한 패널에서

|  |  |
| --- | --- |
| **홈 작업 공간** | 집중 타이머, 빠른 메모, 황력, 일출·일몰 등 위젯을 배치 |
| **할 일과 메모** | 1–8개 할 일 분류와 마감 알림, Markdown 메모와 라이브러리 |
| **링크와 녹음** | 사이트 분류 저장, 녹음, 선택적 실시간 받아쓰기와 스마트 이름 |
| **AI 도우미** | 여러 AI 잔여 할당량 확인, 연결된 출처의 완료 알림 수신 |
| **클립보드와 자격 증명** | 필요할 때 클립보드 기록 사용, 시스템 보안 저장소로 암호화 |
| **NAS 동기화** | 선택적으로 fnOS NAS와 페어링해 기기 간 동기화 |

## 시작하기

1. [Releases](https://github.com/Sunanang/Pome-Panel/releases)에서 설치 파일을 받으세요. Mac은 `arm64.dmg`, Windows는 `windows-x64-setup.exe`.
2. 앱을 열고 화면 가장자리 캡슐을 클릭하세요. 접힌 상태에서 끌어 위치를 바꿀 수 있습니다.
3. 설정에서 필요한 기능을 고르세요. AI, 받아쓰기, NAS는 선택 사항입니다.

설치 파일은 Releases가 기준입니다. 없으면 소스에서 실행하세요. 진행 중인 작업은 [changelog](CHANGELOG.en.md)를 보세요.

> 데이터는 로컬 `Pome Panel` 폴더에 저장되며 변경할 수 있습니다. NAS 동기화는 선택 사항입니다. Windows 일부 네이티브 기능은 기본 꺼짐입니다([가이드](docs/user-guide.en.md#windows)).

## 소스에서 실행

```bash
git clone --branch dev https://github.com/Sunanang/Pome-Panel.git
cd Pome-Panel
npm install
npm run setup:hooks
npm start
```

Node.js 18+. 테스트, 웹사이트, NAS, 빌드는 [개발 문서](docs/development.en.md)를 참고하세요.

## 더 보기

[사용 가이드](docs/user-guide.en.md) · [개발](docs/development.en.md) · [Changelog](CHANGELOG.en.md) · [NAS](fnos/)

UI는 English, 简体中文, 繁體中文, 日本語, 한국어, Español, Français, Deutsch, Русский, Português (Brasil)를 지원합니다. 신규 번역은 검수 중이며 스크린샷과 전통 황력 표현은 원문을 유지합니다.

---

[TO-DO-Panel](https://github.com/xiaopu-ai/TO-DO-Panel)을 기반으로 합니다. 원작자에게 감사합니다.

[MIT License](LICENSE) · [Sunanang](https://github.com/Sunanang)
