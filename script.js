// Firebaseが接続されているか確認用（コンソールに表示）
console.log("Firebase DB:", db);

// デバッグ用
console.log("Firebase loaded?", typeof firebase !== "undefined");
console.log("Database object:", db);


const MAP_ROWS = 9;
const MAP_COLUMNS = 18;

const HEX_CENTER_START_X = 147;
const HEX_CENTER_START_Y = 152;
const HEX_X_INTERVAL = 113;
const HEX_Y_INTERVAL = 151;

const blockedCells = [17, 146];

const initialPositions = {
  A: [8, 9, 16, 18, 26, 27],
  B: [136, 137, 145, 147, 154, 155]
};

let movingUnit = null;
let isMovingMode = false;

let selectedTeam = null;
let selectedUnit = null;
const occupiedCells = new Set();
const occupiedUnits = new Set();

const sUnitCount = {
  "s_unit01.png": 0,
  "s_unit02.png": 0
};

const unitInstanceCount = {};
const teamPoints = { A: 0, B: 0 };

let playerInfo = null;

window.onload = () => {
  document.getElementById("logoutButton").style.display = "none";
  document.getElementById("resetButton").style.display = "none";
};


function login() {
  const team = document.getElementById("teamSelect").value;
  const name = document.getElementById("playerName").value.trim();
  const skill = parseInt(document.getElementById("skill").value);
  const reflex = parseInt(document.getElementById("reflex").value);
  const mind = parseInt(document.getElementById("mind").value);

  if (!name || isNaN(skill) || isNaN(reflex) || isNaN(mind)) {
    document.getElementById("loginError").textContent = "すべて入力してください。";
    return;
  }

  if (skill + reflex + mind !== 12) {
    document.getElementById("loginError").textContent = "技能・反応・精神の合計は12にしてください。";
    return;
  }

  // エラーをクリア
  document.getElementById("loginError").textContent = "";

  // プレイヤー情報を作成
  playerInfo = { team, name, skill, reflex, mind };

  // IDを生成してローカル保存（すでにある場合は再利用）
  const playerID = localStorage.getItem("playerID") || crypto.randomUUID();
  localStorage.setItem("playerID", playerID);

  // Firebaseに保存
  firebase.database().ref(`players/${playerID}`).set(playerInfo);

  // ログイン後の表示切り替え
  document.getElementById("loginArea").style.display = "none";
  document.getElementById("gameArea").style.display = "flex";
  document.getElementById("diceArea").style.display = "block";
  document.getElementById("missionArea").style.display = "flex";
  document.getElementById("logoutButton").style.display = "inline-block";

  // チームごとのユニット選択リストを表示
  renderUnitList("A");
  renderUnitList("B");

  // チーム見出しの強調
  document.querySelector(`#${team === 'A' ? 'leftPanel' : 'rightPanel'} h2`)
    .classList.add(team === 'A' ? 'selected-a' : 'selected-b');

  // マス再描画
  showAllHexLabels();

  firebase.database().ref("units").on("value", snapshot => {
    const units = snapshot.val();
    updateUnitsFromFirebase(units);
  });

  firebase.database().ref("resetFlag").on("value", snapshot => {
    if (snapshot.val()) {
      // （中略）初期化処理
    }
  });

  // 🔽 ここに追加
  firebase.database().ref("missions").once("value", snapshot => {
    if (!snapshot.exists()) {
      initializeMissions(); // 最初のログイン時に1度だけ実行
    }
  });
  showSharedMissions();

}

function getHexPixelPosition(cellNumber) {
  const index = cellNumber - 1;
  const col = Math.floor(index / MAP_ROWS);
  const row = index % MAP_ROWS;
  const mapImage = document.getElementById("mapImage");
  const scale = mapImage.clientWidth / mapImage.naturalWidth;
  const yOffset = (col % 2 === 1) ? HEX_Y_INTERVAL / 2 : 0;
  const x = (HEX_CENTER_START_X + col * HEX_X_INTERVAL) * scale;
  const y = (HEX_CENTER_START_Y + row * HEX_Y_INTERVAL + yOffset) * scale;
  return { left: x, top: y };
}

function showAllHexLabels() {
  const container = document.getElementById("hexLabels");
  container.innerHTML = "";
  const totalCells = MAP_ROWS * MAP_COLUMNS;
  for (let cellNum = 1; cellNum <= totalCells; cellNum++) {
    if (blockedCells.includes(cellNum)) continue;
    const pos = getHexPixelPosition(cellNum);
    const label = document.createElement("div");
    label.className = "hexLabel";
    label.style.left = `${pos.left}px`;
    label.style.top = `${pos.top}px`;
    label.innerText = cellNum;
    label.dataset.cellnum = cellNum;
    label.onclick = () => handleHexClick(label);
    container.appendChild(label);
  }
}

function handleHexClick(label) {
  const clickedCellNum = Number(label.dataset.cellnum);
  if (isMovingMode && movingUnit) {
    if (!occupiedCells.has(clickedCellNum)) {
      moveUnitToCell(movingUnit, clickedCellNum);
      movingUnit = null;
      isMovingMode = false;
      clearMoveHighlights();
    }
    return;
  }
  if (!selectedUnit) return;
  const team = selectedTeam;
  const allowed = initialPositions[team];
  if (!allowed.includes(clickedCellNum)) return;
  if (occupiedCells.has(clickedCellNum)) return;
  placeUnitOnMap(clickedCellNum, selectedUnit);
  occupiedCells.add(clickedCellNum);
  removeUnitCard(selectedUnit);
  clearSelectedUnit();
}

function selectTeam(team) {
  selectedTeam = team;
  selectedUnit = null;
  clearSelectedUnit();
  renderUnitList(team);
}

function renderUnitList(team) {
  const container = document.getElementById(team === 'A' ? 'unitListA' : 'unitListB');
  container.innerHTML = "";
  const images = [
    team === "A" ? "s_unit01.png" : "s_unit02.png",
    ...Array.from({ length: 14 }, (_, i) => `unit${String(i + 1).padStart(2, '0')}.png`)
  ];
  for (const img of images) {
    if (/^unit\d{2}\.png$/.test(img) && occupiedUnits.has(img)) continue;
    const card = createUnitCard(img, team);
    container.appendChild(card);
  }
}

function clearSelectedUnit() {
  selectedUnit = null;
  document.querySelectorAll(".unitCard img").forEach(el => {
    el.classList.remove("selected-a", "selected-b");
  });
  document.querySelectorAll(".hexLabel").forEach(el => {
    el.classList.remove("allowed-a", "allowed-b");
  });
}

function createUnitCard(filename, team) {
  const wrapper = document.createElement("div");
  wrapper.className = "unitCard";
  wrapper.dataset.filename = filename;

  const img = document.createElement("img");
  img.src = `images/${filename}`;
  img.alt = filename;
  img.dataset.team = team;
  img.dataset.filename = filename;

  // ★ここでチームチェックを追加
  img.addEventListener("click", () => {
    if (!playerInfo || playerInfo.team !== team) {
      alert("自分のチームのユニットのみ選択できます。");
      return;
    }

    clearSelectedUnit();
    selectedTeam = team;
    img.classList.add(team === "A" ? "selected-a" : "selected-b");
    selectedUnit = filename;
    highlightAllowedCells(team);
  });

  wrapper.appendChild(img);
  return wrapper;
}


function highlightAllowedCells(team) {
  document.querySelectorAll(".hexLabel").forEach(el => {
    el.classList.remove("allowed-a", "allowed-b");
  });
  const targets = initialPositions[team];
  for (const num of targets) {
    if (occupiedCells.has(num)) continue;
    const label = document.querySelector(`.hexLabel[data-cellnum="${num}"]`);
    if (label) {
      label.classList.add(team === "A" ? "allowed-a" : "allowed-b");
    }
  }
}

function placeUnitOnMap(cellNum, filename) {
  if (!cellNum || cellNum < 1 || cellNum > MAP_ROWS * MAP_COLUMNS) return;

  const pos = getHexPixelPosition(cellNum);
  const unitLayer = document.getElementById("unitLayer");
  const img = document.createElement("img");
  img.src = `images/${filename}`;
  img.className = `unitOnMap ${selectedTeam.toLowerCase()}`;
  img.style.left = `${pos.left}px`;
  img.style.top = `${pos.top}px`;
  unitLayer.appendChild(img);

  let count = null;
  if (filename === "s_unit01.png" || filename === "s_unit02.png") {
    sUnitCount[filename] = (sUnitCount[filename] || 0) + 1;
    count = sUnitCount[filename];
    if (count > 1) {
      const label = document.createElement("div");
      label.className = "unitNumberLabel";
      label.innerText = `（${count}）`;
      label.style.left = `${pos.left}px`;
      label.style.top = `${pos.top - 20}px`;
      unitLayer.appendChild(label);
    }
  }

  if (/^unit\d{2}\.png$/.test(filename)) {
    occupiedUnits.add(filename);
  }

  occupiedCells.add(cellNum);
  removeUnitCard(filename);
  clearSelectedUnit();
  renderUnitList("A");
  renderUnitList("B");
  showUnitStatus(selectedTeam, filename, count);

  const team = selectedTeam;
  img.addEventListener("click", () => {
    if (playerInfo && playerInfo.team !== team) return;
    movingUnit = { img, filename };
    isMovingMode = true;

    document.querySelectorAll(".hexLabel").forEach(label => {
      const cell = Number(label.dataset.cellnum);
      if (!occupiedCells.has(cell)) {
        label.classList.add("highlight-move");
        label.onclick = () => {
          moveUnitToCell(movingUnit, cell);
          movingUnit = null;
          isMovingMode = false;
          clearMoveHighlights();
        };
      }
    });
  });

  // ✅ 修正1：ユニットIDを生成し、Firebaseとローカルに記録
  const safeFilename = filename.replace(/\./g, "_");
  const unitID = `${safeFilename}_${Date.now()}`;
  unitInstanceCount[unitID] = true;  // ローカル記録

  firebase.database().ref(`units/${unitID}`).set({
    unitID,
    filename,
    cellNum,
    team,
    playerName: playerInfo?.name || "unknown",
    count: sUnitCount[filename] || 1,
    skill: playerInfo?.skill || 0,
    reflex: playerInfo?.reflex || 0,
    mind: playerInfo?.mind || 0,
    hp: unitInfo[filename]?.hp || 1
  });
}

function removeUnitCard(filename) {
  if (/^unit\d{2}\.png$/.test(filename)) {
    const card = document.querySelector(`.unitCard[data-filename="${filename}"]`);
    if (card) card.remove();
  }
}

function clearUnitStatusPanels() {
  document.getElementById("unitStatusA").innerHTML = "";
  document.getElementById("unitStatusB").innerHTML = "";
}

function showUnitStatus(team, filename, count = null) {
  const info = unitInfo[filename];
  if (!info) return;

  let labelName = info.name;
  if ((filename === "s_unit01.png" || filename === "s_unit02.png") && count > 1) {
    labelName += `（${count}）`;
  }

  const container = document.getElementById(team === 'A' ? 'unitStatusA' : 'unitStatusB');
  if (!container) return;

  const div = document.createElement('div');
  div.className = 'unitStatus';
  div.dataset.filename = filename;
  div.dataset.team = team;
  div.dataset.count = count || 1;

  // 🔽 ここを修正：playerInfo が null のときは空欄にする
  const playerName = playerInfo?.name || "（不明）";
  const skill = playerInfo?.skill ?? "-";
  const reflex = playerInfo?.reflex ?? "-";
  const mind = playerInfo?.mind ?? "-";

  div.innerHTML = `
    <div class="playerInfo">${playerName}</div>
    <div class="playerStats">技術${skill} 反応${reflex} 精神${mind}</div>
    <div class="unitName">${labelName}</div>
    <div class="unitHP">
      耐久値 <span class="hp">${info.hp}</span>
      <button onclick="adjustHP(this, +1)">＋</button>
      <button onclick="adjustHP(this, -1)">－</button>
      <button onclick="deleteUnit(this)">削除</button>
    </div>
  `;
  container.appendChild(div);
}


function adjustHP(button, delta) {
  const hpSpan = button.parentElement.querySelector(".hp");
  let hp = parseInt(hpSpan.textContent);
  hp = Math.max(0, hp + delta);
  hpSpan.textContent = hp;
}

function deleteUnit(button) {
  const unitDiv = button.closest(".unitStatus");
  const filename = unitDiv.dataset.filename;
  const team = unitDiv.dataset.team;
  const count = parseInt(unitDiv.dataset.count);

  // ★ 自軍のユニット以外は削除できない
  if (!playerInfo || playerInfo.team !== team) {
    alert("自分のチームのユニットのみ削除できます。");
    return;
  }

  // ユニット画像を削除
  const unitsOnMap = document.querySelectorAll(`.unitOnMap.${team.toLowerCase()}`);
  for (let unit of unitsOnMap) {
    if (unit.src.includes(filename)) {
      unit.remove();
      break;
    }
  }

  // ラベル削除（s_unit の場合）
  if (filename === "s_unit01.png" || filename === "s_unit02.png") {
    const labels = document.querySelectorAll(".unitNumberLabel");
    for (let label of labels) {
      if (label.innerText === `（${count}）`) {
        label.remove();
        break;
      }
    }
    sUnitCount[filename]--;
  }

  // ユニット情報削除
  unitDiv.remove();
  if (/^unit\d{2}\.png$/.test(filename)) {
    occupiedUnits.delete(filename);
    renderUnitList("A");
    renderUnitList("B");
  }
}


function clearMoveHighlights() {
  document.querySelectorAll(".hexLabel").forEach(label => {
    label.classList.remove("highlight-move");
    label.onclick = () => handleHexClick(label);
  });
}

function moveUnitToCell(unit, newCellNum) {
  if (!unit || !unit.unitID || !newCellNum) return;

  const pos = getHexPixelPosition(newCellNum);
  unit.img.style.left = `${pos.left}px`;
  unit.img.style.top = `${pos.top}px`;

  firebase.database().ref(`units/${unit.unitID}/cellNum`).set(newCellNum);
}


function getUnitIDFromImg(src) {
  const matches = src.match(/\/([^/]+)\.png/);
  const filename = matches ? matches[1].replace(/\./g, "_") : "unknown";
  const allKeys = Object.keys(unitInstanceCount);
  return allKeys.find(key => key.startsWith(filename));
}


function showSharedMissions() {
  firebase.database().ref("missions").on("value", snapshot => {
    const missions = snapshot.val();
    if (!missions) return;

    const container = document.getElementById("missionArea");
    container.innerHTML = "";

    missions.forEach((mission, index) => {
      const wrapper = document.createElement("div");
      wrapper.className = "missionWrapper";

      const img = document.createElement("img");
      img.src = `images/mission/${mission.filename}`;
      img.className = "missionCard";

      const label = document.createElement("div");
      label.className = "clearLabel";
      label.innerText = "クリア";
      label.style.display = mission.cleared ? "block" : "none";

      const buttonArea = document.createElement("div");
      buttonArea.className = "missionButtons";

      const clearBtn = document.createElement("button");
      clearBtn.innerText = "クリア";
      clearBtn.onclick = () => {
        firebase.database().ref(`missions/${index}/cleared`).set(true);
      };

      const resetBtn = document.createElement("button");
      resetBtn.innerText = "戻す";
      resetBtn.onclick = () => {
        firebase.database().ref(`missions/${index}/cleared`).set(false);
      };

      buttonArea.appendChild(clearBtn);
      buttonArea.appendChild(resetBtn);

      wrapper.appendChild(img);
      wrapper.appendChild(label);
      wrapper.appendChild(buttonArea);
      container.appendChild(wrapper);
    });
  });
}

function initializeMissions() {
  const all = [
    "mission01.png", "mission02.png", "mission03.png", "mission04.png",
    "mission05.png", "mission06.png", "mission07.png", "mission08.png",
    "mission09.png", "mission10.png", "mission11.png", "mission12.png"
  ];
  const selected = all.sort(() => 0.5 - Math.random()).slice(0, 5);
  const data = selected.map(filename => ({ filename, cleared: false }));

  firebase.database().ref("missions").set(data);
}

let unitInfo = {};
fetch('unit_data.json')
  .then(response => response.json())
  .then(data => {
    unitInfo = data;
    showAllHexLabels();
    selectTeam('A');
    renderUnitList('B');
    showSharedMissions();  // ミッションを表示

    // ユニット情報の同期
    firebase.database().ref("units").on("value", snapshot => {
      const units = snapshot.val();
      updateUnitsFromFirebase(units);
    });

    // 🔁 resetFlag の監視（誰かが初期化したら全員ログアウト）
    firebase.database().ref("resetFlag").on("value", snapshot => {
      if (snapshot.val()) {
        alert("ゲームが初期化されました。再ログインしてください。");

        // ローカルデータのクリア
        localStorage.removeItem("playerID");
        playerInfo = null;

        // 表示をログイン画面に戻す
        document.getElementById("loginArea").style.display = "block";
        document.getElementById("gameArea").style.display = "none";
        document.getElementById("diceArea").style.display = "none";
        document.getElementById("missionArea").style.display = "none";

        // 画面内容の初期化
        document.getElementById("unitLayer").innerHTML = "";
        document.getElementById("diceResult").textContent = "-";
        document.getElementById("rollButton").disabled = false;
        occupiedCells.clear();
        occupiedUnits.clear();
        renderUnitList("A");
        renderUnitList("B");

        // フラグを削除（次回のため）
        firebase.database().ref("resetFlag").remove();
      }
    });
  });


  function adjustPoint(team, delta) {
  teamPoints[team] += delta;
  if (teamPoints[team] < 0) teamPoints[team] = 0;
  document.getElementById(`point${team}`).textContent = teamPoints[team];
}

function rollDice() {
  const result = Math.floor(Math.random() * 6) + 1;
  const playerID = localStorage.getItem("playerID") || "unknown";

  // Firebaseに出目を保存
  firebase.database().ref("dice").set({
    value: result,
    rolledBy: playerID
  });

  // ボタン無効化（同期処理でも反映されるのでここで更新しなくてもよいが一応）
  document.getElementById("rollButton").disabled = true;
}

// Firebaseのdiceノードを監視して出目を反映
firebase.database().ref("dice").on("value", (snapshot) => {
  const data = snapshot.val();
  
  if (!data) {
    // リセット時：全員に「-」を表示し、ボタンを有効化
    document.getElementById("diceResult").textContent = "-";
    document.getElementById("rollButton").disabled = false;
    return;
  }

  // サイコロを振ったときの処理（そのまま）
  const result = data.value;
  const rolledBy = data.rolledBy;
  const myID = localStorage.getItem("playerID");

  document.getElementById("diceResult").textContent = result;
  document.getElementById("rollButton").disabled = true;
});

function resetDice() {
  firebase.database().ref("dice").set(null);  // Firebaseから削除

  // ローカル画面を初期化
  document.getElementById("diceResult").textContent = "-";
  document.getElementById("rollButton").disabled = false;
}

firebase.database().ref("units").on("value", (snapshot) => {
  const allUnits = snapshot.val();
  if (!allUnits) return;

  document.getElementById("unitLayer").innerHTML = "";

  for (const key in allUnits) {
    const u = allUnits[key];
    if (!u || !u.filename || !u.cellNum || !u.team) continue;

    const pos = getHexPixelPosition(u.cellNum);

    // ユニット画像を生成してマップに配置
    const img = document.createElement("img");
    img.src = `images/${u.filename}`;
    img.className = `unitOnMap ${u.team.toLowerCase()}`;
    img.style.left = `${pos.left}px`;
    img.style.top = `${pos.top}px`;
    document.getElementById("unitLayer").appendChild(img);

    // s_unit 用のカウントラベル（2以上のとき）
    if ((u.filename === "s_unit01.png" || u.filename === "s_unit02.png") && u.count > 1) {
      const label = document.createElement("div");
      label.className = "unitNumberLabel";
      label.innerText = `（${u.count}）`;
      label.style.left = `${pos.left}px`;
      label.style.top = `${pos.top - 20}px`;
      document.getElementById("unitLayer").appendChild(label);
    }

    // 🔽 ここでクリックイベントを付けて、移動モードに入れるようにする
    img.addEventListener("click", () => {
      if (playerInfo && playerInfo.team !== u.team) return;

      movingUnit = { img, filename: u.filename, unitID: key };
      isMovingMode = true;

      document.querySelectorAll(".hexLabel").forEach(label => {
        const cell = Number(label.dataset.cellnum);
        if (!occupiedCells.has(cell)) {
          label.classList.add("highlight-move");
          label.onclick = () => {
            moveUnitToCell(movingUnit, cell);
            movingUnit = null;
            isMovingMode = false;
            clearMoveHighlights();
          };
        }
      });
    });
  }
});


function updateUnitsFromFirebase(units) {
  const containerA = document.getElementById("unitListA");
  const containerB = document.getElementById("unitListB");
  containerA.innerHTML = "";
  containerB.innerHTML = "";

  // 🔧 出撃済みユニットを初期化してから再登録（重要！）
  occupiedUnits.clear();

  // 🔧 出撃中ユニットステータスの表示もリセット（追加！）
  clearUnitStatusPanels();

  for (const key in units) {
    const u = units[key];

    // 不完全なデータはスキップ
    if (!u || !u.team || !u.filename || !u.cellNum) continue;

    // 🔧 出撃済みユニットを記録（unitXX系のみ）
    if (/^unit\d{2}\.png$/.test(u.filename)) {
      occupiedUnits.add(u.filename);
    }

    if (!playerInfo) return;  // またはプレイヤー未ログインならスキップ

    // 🔽 出撃中ユニット一覧の表示（左・右）
    const wrapper = document.createElement("div");
    wrapper.className = "unitWrapper";

    const img = document.createElement("img");
    img.src = `images/${u.filename}`;
    img.className = "unitOnMap";

    const label = document.createElement("div");
    label.innerText = `${u.playerName}（技${u.skill} 反${u.reflex} 精${u.mind}）`;

    const hpArea = document.createElement("div");
    hpArea.className = "hpArea";

    const hpMinus = document.createElement("button");
    hpMinus.innerText = "-";
    hpMinus.onclick = () => {
      if (u.hp > 0) {
        firebase.database().ref(`units/${key}/hp`).set(u.hp - 1);
      }
    };

    const hpDisplay = document.createElement("span");
    hpDisplay.innerText = u.hp;
    hpDisplay.className = "hpDisplay";

    const hpPlus = document.createElement("button");
    hpPlus.innerText = "+";
    hpPlus.onclick = () => {
      firebase.database().ref(`units/${key}/hp`).set(u.hp + 1);
    };

    hpArea.appendChild(hpMinus);
    hpArea.appendChild(hpDisplay);
    hpArea.appendChild(hpPlus);

    label.appendChild(hpArea);
    wrapper.appendChild(img);
    wrapper.appendChild(label);

    if (u.team === "A") {
      containerA.appendChild(wrapper);
    } else if (u.team === "B") {
      containerB.appendChild(wrapper);
    }

    // 🔽 出撃中ユニットステータスエリアにも表示（重要！）
    showUnitStatus(u.team, u.filename, u.count);
  }

  // 🔁 ユニットリストを再表示（出撃可能ユニット）
  renderUnitList("A");
  renderUnitList("B");
}

function logout() {
  // ローカル情報を削除（ただし Firebase データは消さない）
  localStorage.removeItem("playerID");
  playerInfo = null;

  // 表示を初期状態に戻す
  document.getElementById("loginArea").style.display = "block";
  document.getElementById("gameArea").style.display = "none";
  document.getElementById("diceArea").style.display = "none";
  document.getElementById("missionArea").style.display = "none";
  document.getElementById("logoutButton").style.display = "none";

  // 選択状態もクリア
  selectedUnit = null;
  selectedTeam = null;
  clearSelectedUnit();
}

function resetGameData() {
  if (!confirm("本当にすべてのプレイヤーとユニット情報を初期化しますか？")) return;

  firebase.database().ref("players").remove();
  firebase.database().ref("units").remove();
  firebase.database().ref("dice").remove();

  // ✅ ミッションも初期化（ここが重要！）
  initializeMissions();

  firebase.database().ref("resetFlag").set(true);

  alert("ゲームデータを初期化しました。");

  // 自分の画面も初期化（すぐ反映させる）
  localStorage.removeItem("playerID");
  playerInfo = null;

  document.getElementById("loginArea").style.display = "block";
  document.getElementById("gameArea").style.display = "none";
  document.getElementById("diceArea").style.display = "none";
  document.getElementById("missionArea").style.display = "none";
  document.getElementById("unitLayer").innerHTML = "";
  document.getElementById("diceResult").textContent = "-";
  document.getElementById("rollButton").disabled = false;
  document.getElementById("logoutButton").style.display = "none";
  occupiedCells.clear();
  occupiedUnits.clear();
  renderUnitList("A");
  renderUnitList("B");
}

