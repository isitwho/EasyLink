# EasyLink

Easily discover and link to similar content across your entire Obsidian vault. Select any text in your editor, and this plugin will instantly find the most relevant notes, headings, or paragraphs.

_Read this in other languages: [English](#english), [한국어 (Korean)](#korean)_

---

## English

### What It Does

This plugin enhances your note-linking workflow. Instead of manually searching for related notes, simply select a phrase or sentence, run the command, and get a ranked list of the most similar content from your vault. You can then insert a link to the relevant content with a single click.

### Features

-   **Contextual Search**: Finds similar content based on shared keywords, not just exact string matches.
-   **Scoring System**: Ranks results by a similarity score, so you can see the most relevant content first.
-   **Precise Linking**: Creates links directly to specific headings or blocks (if they have a block ID).
-   **Quick Access**: Use the ribbon icon or a command to trigger the search.
-   **Open in New Tab**: `Ctrl/Cmd` + click on a result to open the note in a new tab instead of inserting a link.
-   **Highly Customizable**:
    -   Exclude specific folders from search.
    -   Adjust the maximum number of results.
    -   Set a minimum similarity score to filter out noise.

### How to Use

1.  Select a word, phrase, or sentence in your note.
2.  Click the "link" icon in the left ribbon, or run the command `EasyLink: Find similar content for selection` from the Command Palette (`Ctrl/Cmd + P`).
3.  A modal will appear with a list of similar content, ranked by relevance.
4.  **To insert a link**: Click on an item in the list. A link (`[[Note#Heading|Your Selected Text]]`) will be inserted at your cursor's position.
5.  **To open the note**: Hold `Ctrl` (Windows/Linux) or `Cmd` (macOS) and click on an item. The note will open in a new tab.

### Settings

You can configure the plugin in the Obsidian settings:

-   **Folders to ignore**: Prevent the plugin from searching in certain folders (e.g., templates, attachments).
-   **Maximum results**: Control how many results are shown in the list.
-   **Minimum score threshold**: Set a minimum similarity score (0-100%) to filter out less relevant results.

### Installation

Once this plugin is available in the community plugin store:

1.  Go to `Settings` > `Community plugins`.
2.  Make sure "Restricted mode" is turned **off**.
3.  Click `Browse` and search for "EasyLink".
4.  Click `Install`, and then `Enable`.

---

## 한국어 (Korean)

### 플러그인 소개

Obsidian Vault 전체에서 가장 유사한 콘텐츠를 쉽게 발견하고 연결하세요. 에디터에서 텍스트를 선택하기만 하면, 이 플러그인이 즉시 가장 관련성 높은 노트, 헤딩, 문단을 찾아줍니다.

### 주요 기능

-   **문맥 기반 검색**: 정확한 문자열 일치가 아닌, 공유된 키워드를 기반으로 유사한 내용을 찾습니다.
-   **점수 시스템**: 검색 결과를 유사도 점수 순으로 정렬하여 가장 관련성 높은 내용을 먼저 보여줍니다.
-   **정확한 링크**: 특정 헤딩이나 블록(블록 ID가 있는 경우)으로 직접 연결되는 링크를 생성합니다.
-   **빠른 접근**: 리본 아이콘이나 명령어를 통해 검색을 실행할 수 있습니다.
-   **새 탭에서 열기**: `Ctrl/Cmd`를 누른 채 검색 결과를 클릭하면 링크를 삽입하는 대신 해당 노트를 새 탭에서 엽니다.
-   **다양한 설정**:
    -   특정 폴더를 검색에서 제외할 수 있습니다.
    -   표시할 최대 결과 개수를 조절할 수 있습니다.
    -   최소 유사도 점수를 설정하여 관련성 낮은 결과를 걸러낼 수 있습니다.

### 사용 방법

1.  노트에서 단어, 구, 문장을 선택합니다.
2.  왼쪽 리본 메뉴의 '링크' 아이콘을 클릭하거나, 커맨드 팔레트(`Ctrl/Cmd + P`)에서 `EasyLink: Find similar content for selection` 명령을 실행합니다.
3.  관련도 순으로 정렬된 유사 콘텐츠 목록이 담긴 모달 창이 나타납니다.
4.  **링크 삽입하기**: 목록에서 원하는 항목을 클릭하세요. 커서 위치에 링크(`[[노트#헤딩|선택했던 텍스트]]`)가 삽입됩니다.
5.  **노트 열기**: `Ctrl`(Windows/Linux) 또는 `Cmd`(macOS) 키를 누른 채 항목을 클릭하세요. 해당 노트가 새 탭에서 열립니다.

### 설정

Obsidian 설정 메뉴에서 플러그인을 설정할 수 있습니다.

-   **무시할 폴더**: 특정 폴더(예: 템플릿, 첨부파일)를 검색 대상에서 제외합니다.
-   **최대 결과 수**: 목록에 표시될 결과의 최대 개수를 조절합니다.
-   **최소 유사도 점수**: 최소 유사도 점수(0-100%)를 설정하여 관련성이 낮은 결과를 필터링합니다.

### 설치 방법

이 플러그인이 커뮤니티 플러그인 스토어에 등록된 후:

1.  `설정` > `커뮤니티 플러그인`으로 이동합니다.
2.  `안전 모드`가 **꺼져 있는지** 확인합니다.
3.  `탐색`을 클릭하고 "EasyLink"를 검색합니다.
4.  `설치`를 클릭한 후, `활성화` 버튼을 누릅니다.
