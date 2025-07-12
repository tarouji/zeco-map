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

const blockedCells = [];

const initialPositions = {
  A: [1, 2, 3, 4, 5, 6, 7, 8, 9, 51, 56, 107, 112],
  B: [154, 155, 156, 157, 158, 159, 160, 161, 162, 51, 56, 107, 112]
};

let movingUnit = null;
let isMovingMode = false;

let selectedTeam = null;
let selectedUnit = null;

let sharedMissionsData = null;
let secretMissionsData = null;

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

  if (
    skill < 1 || skill > 6 ||
    reflex < 1 || reflex > 6 ||
    mind < 1 || mind > 6
  ) {
    document.getElementById("loginError").textContent = "技能・反応・精神は1〜6で入力してください。";
    return;
  }

  if (skill + reflex + mind !== 12) {
    document.getElementById("loginError").textContent = "技能・反応・精神の合計は12にしてください。";
    return;
  }

  document.getElementById("loginError").textContent = "";

  // ✅ プレイヤー情報をここでセット
  playerInfo = { team, name, skill, reflex, mind };

  // ✅ ローカルIDを生成・保存
  const playerID = localStorage.getItem("playerID") || crypto.randomUUID();
  localStorage.setItem("playerID", playerID);

  // ✅ Firebaseにプレイヤー情報登録
  firebase.database().ref(`players/${playerID}`).set(playerInfo);

  // ✅ 表示切り替え
  toggleGameUI(true);

  // ✅ ユニット選択リストとラベル表示
  renderUnitList("A");
  renderUnitList("B");
  showAllHexLabels();

  // ✅ チーム名の強調表示
  document.querySelector(`#${team === 'A' ? 'leftPanel' : 'rightPanel'} h2`)
    .classList.add(team === 'A' ? 'selected-a' : 'selected-b');

  // 🔽 出撃選択タイトルをプレイヤー名に変更
  document.querySelector("#unitListA").previousElementSibling.textContent =
    team === "A" ? `出撃選択（${name}）` : "出撃選択";
  document.querySelector("#unitListB").previousElementSibling.textContent =
    team === "B" ? `出撃選択（${name}）` : "出撃選択";

  // ✅ 初期化フラグの監視
  firebase.database().ref("resetFlag").on("value", snapshot => {
    if (snapshot.val()) {
      // （省略）初期化処理は fetch 監視と同様
    }
  });

  // ✅ 初回ログイン時のみミッション初期化し、そのあと表示
  firebase.database().ref("missions").once("value", snapshot => {
    if (!snapshot.exists()) {
      initializeMissions();
    }
  
  });

  showSharedMissions();  // ← 削除せずにここは残す
  console.log("ログイン完了", playerInfo);

}

function toggleGameUI(isLoggedIn) {
  document.getElementById("loginArea").style.display = isLoggedIn ? "none" : "block";
  document.getElementById("gameArea").style.display = isLoggedIn ? "flex" : "none";
  document.getElementById("diceArea").style.display = isLoggedIn ? "block" : "none";

  document.getElementById("commonMissionArea").style.display = isLoggedIn ? "block" : "none";
  document.getElementById("teamMissionArea").style.display = isLoggedIn ? "block" : "none";

  document.getElementById("eventArea").style.display = isLoggedIn ? "block" : "none";

  document.getElementById("logoutButton").style.display = isLoggedIn ? "inline-block" : "none";
  document.getElementById("resetButton").style.display = isLoggedIn ? "inline-block" : "none";
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
      alert("自軍側のユニットを選択してください。");
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

  if (!unitInfo || !unitInfo[filename]) {
    alert("ユニットデータの読み込みが完了していません。少し待ってから再試行してください。");
    return;
  }

  const team = selectedTeam;

  // unitXX の場合は出撃済みとして記録
  if (/^unit\d{2}\.png$/.test(filename)) {
    occupiedUnits.add(filename);
  }

  occupiedCells.add(cellNum);
  removeUnitCard(filename);
  clearSelectedUnit();
  renderUnitList("A");
  renderUnitList("B");

  const safeFilename = filename.replace(/\./g, "_");
  const unitID = `${safeFilename}_${Date.now()}`;
  unitInstanceCount[unitID] = true;

  // 🔽 s_unit の場合：チーム単位で Firebase 上のカウントを使って保存
  if (filename === "s_unit01.png" || filename === "s_unit02.png") {
    firebase.database().ref(`s_unitCounts/${team}`).transaction(current => {
      return (current || 0) + 1;
    }).then(result => {
      const count = result.snapshot.val();

      firebase.database().ref(`units/${unitID}`).set({
        unitID,
        filename,
        cellNum,
        team,
        playerName: playerInfo?.name || "unknown",
        count: count,  // ✅ ここで共有カウントを使う
        skill: playerInfo?.skill || 0,
        reflex: playerInfo?.reflex || 0,
        mind: playerInfo?.mind || 0,
        hp: unitInfo[filename]?.hp || 1
      });
    });
  } else {
    // unitXX はカウントなしでそのまま保存
    firebase.database().ref(`units/${unitID}`).set({
      unitID,
      filename,
      cellNum,
      team,
      playerName: playerInfo?.name || "unknown",
      count: 1,
      skill: playerInfo?.skill || 0,
      reflex: playerInfo?.reflex || 0,
      mind: playerInfo?.mind || 0,
      hp: unitInfo[filename]?.hp || 1
    });
  }
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

function showUnitStatus(team, filename, count = null, playerData = null) {
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

  const playerName = playerData?.playerName || "（不明）";
  const skill = playerData?.skill ?? "-";
  const reflex = playerData?.reflex ?? "-";
  const mind = playerData?.mind ?? "-";

  const currentHP = playerData?.hp ?? info.hp;  // 🔧 ここを修正！

  div.innerHTML = `
    <div class="unitName">${labelName}
      <button onclick="deleteUnit(this)">削除</button>
    </div>
    <div class="unitHP">
      耐久値 <span class="hp">${currentHP}</span>
      <button onclick="adjustHP(this, +1)">＋</button>
      <button onclick="adjustHP(this, -1)">－</button>
    </div>
    <div class="playerInfo">${playerName}</div>
    <div class="playerStats">技術${skill} 反応${reflex} 精神${mind}</div>
  `;
  container.appendChild(div);
}

function adjustHP(button, delta) {
  const hpSpan = button.parentElement.querySelector(".hp");
  let hp = parseInt(hpSpan.textContent);
  hp = Math.max(0, hp + delta);
  hpSpan.textContent = hp;

  const unitDiv = button.closest(".unitStatus");
  const filename = unitDiv.dataset.filename;
  const team = unitDiv.dataset.team;
  const count = parseInt(unitDiv.dataset.count);

  // Firebaseに登録されているユニットIDを探す
  firebase.database().ref("units").once("value").then(snapshot => {
    const allUnits = snapshot.val();
    for (const key in allUnits) {
      const u = allUnits[key];
      if (u && u.filename === filename && u.team === team && u.count === count) {
        firebase.database().ref(`units/${key}/hp`).set(hp);
        break;
      }
    }
  });
}

function deleteUnit(button) {
  const unitDiv = button.closest(".unitStatus");
  const filename = unitDiv.dataset.filename;
  const team = unitDiv.dataset.team;
  const count = parseInt(unitDiv.dataset.count);

  // ★ 自軍のユニット以外は削除できない
  if (!playerInfo || playerInfo.team !== team) {
    alert("自軍のユニットのみ削除できます。");
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
  }

  // occupiedCells から cellNum を削除（Firebaseから位置取得）
  firebase.database().ref("units").once("value").then(snapshot => {
    const allUnits = snapshot.val();
    for (const key in allUnits) {
      const u = allUnits[key];
      if (u && u.filename === filename && u.team === team && u.count === count) {
        firebase.database().ref(`units/${key}`).remove();  // Firebaseから削除
        occupiedCells.delete(u.cellNum);  // ローカルから削除
        break;
      }
    }
  });

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

  // 🔽 Firebase から元の cellNum を取得して、occupiedCells から削除
  firebase.database().ref(`units/${unit.unitID}/cellNum`).once("value", snapshot => {
    const oldCellNum = snapshot.val();
    if (oldCellNum) occupiedCells.delete(oldCellNum);  // ← 元のマスを空きに

    // 🔽 新しい位置にユニットを移動
    const pos = getHexPixelPosition(newCellNum);
    unit.img.style.left = `${pos.left}px`;
    unit.img.style.top = `${pos.top}px`;

    // 🔽 新しいマスを occupied に追加
    occupiedCells.add(newCellNum);

    // 🔽 Firebase にも更新
    firebase.database().ref(`units/${unit.unitID}/cellNum`).set(newCellNum);
  });
}


function getUnitIDFromImg(src) {
  const matches = src.match(/\/([^/]+)\.png/);
  const filename = matches ? matches[1].replace(/\./g, "_") : "unknown";
  const allKeys = Object.keys(unitInstanceCount);
  return allKeys.find(key => key.startsWith(filename));
}

function clearMoveMode() {
  movingUnit = null;
  isMovingMode = false;
  clearMoveHighlights();
}

function showSharedMissions() {
  firebase.database().ref("missions").on("value", snapshot => {
    sharedMissionsData = snapshot.val();
    renderMissions();
  });

  firebase.database().ref("secretMissions").on("value", snapshot => {
    secretMissionsData = snapshot.val();
    renderMissions();
  });
}


function renderMissions() {
  // 共通ミッション描画先
  const commonContainer = document.getElementById("commonMissions");
  commonContainer.innerHTML = "";
  if (sharedMissionsData) {
    sharedMissionsData.forEach((mission, index) => {
      const wrapper = createMissionCard(mission, index, "missions");
      commonContainer.appendChild(wrapper);
    });
  }

  // チーム別ミッション描画先
  const aContainer = document.getElementById("teamAMissions");
  const bContainer = document.getElementById("teamBMissions");
  aContainer.innerHTML = "";
  bContainer.innerHTML = "";

  if (!playerInfo) return;

  // A軍ミッションタイトル
  const aTitle = document.createElement("h4");
  if (secretMissionsData?.A) {
    aTitle.textContent = secretMissionsData.A.revealed ? "A軍（公開）" : "A軍（非公開）";
  } else {
    aTitle.textContent = "A軍（非公開）";
  }
  aContainer.appendChild(aTitle);

  // B軍ミッションタイトル
  const bTitle = document.createElement("h4");
  if (secretMissionsData?.B) {
    bTitle.textContent = secretMissionsData.B.revealed ? "B軍（公開）" : "B軍（非公開）";
  } else {
    bTitle.textContent = "B軍（非公開）";
  }
  bContainer.appendChild(bTitle);

  // A軍ミッション画像（条件付き表示）
  if (secretMissionsData?.A) {
    if (secretMissionsData.A.revealed || playerInfo.team === "A") {
      const aWrapper = createSecretMissionCard(secretMissionsData.A, "A", secretMissionsData.A.revealed);
      aContainer.appendChild(aWrapper);
    }
  }

  // B軍ミッション画像（条件付き表示）
  if (secretMissionsData?.B) {
    if (secretMissionsData.B.revealed || playerInfo.team === "B") {
      const bWrapper = createSecretMissionCard(secretMissionsData.B, "B", secretMissionsData.B.revealed);
      bContainer.appendChild(bWrapper);
    }
  }
}

function createMissionCard(mission, index, pathPrefix) {
  const wrapper = document.createElement("div");
  wrapper.className = "missionWrapper";

  const img = document.createElement("img");
  img.src = `images/mission/${mission.filename}`;
  img.className = "missionCard";

  const label = document.createElement("div");
  label.className = "clearLabel";
  label.innerText = "達成済";
  label.style.display = mission.cleared ? "block" : "none";

  const buttonArea = document.createElement("div");
  buttonArea.className = "missionButtons";

  const clearBtn = document.createElement("button");
  clearBtn.innerText = "達成";
  clearBtn.onclick = () => {
    firebase.database().ref(`${pathPrefix}/${index}/cleared`).set(true);
  };

  const resetBtn = document.createElement("button");
  resetBtn.innerText = "戻す";
  resetBtn.onclick = () => {
    firebase.database().ref(`${pathPrefix}/${index}/cleared`).set(false);
  };

  buttonArea.appendChild(clearBtn);
  buttonArea.appendChild(resetBtn);

  wrapper.appendChild(img);
  wrapper.appendChild(label);
  wrapper.appendChild(buttonArea);

  return wrapper;
}

function createSecretMissionCard(mission, team, isRevealed) {
  const wrapper = document.createElement("div");
  wrapper.className = "missionWrapper";

  const img = document.createElement("img");
  img.src = `images/mission/${mission.filename}`;
  img.className = "missionCard";
  // ここでクラスを付ける
  img.classList.add(team === "A" ? "secret-a" : "secret-b");

  wrapper.appendChild(img);

  if (!isRevealed) {
    const buttonArea = document.createElement("div");
    buttonArea.className = "missionButtons";

    const revealBtn = document.createElement("button");
    revealBtn.innerText = "公開する";
    revealBtn.onclick = () => {
      firebase.database().ref(`secretMissions/${team}/revealed`).set(true);
    };

    buttonArea.appendChild(revealBtn);
    wrapper.appendChild(buttonArea);
  }

  return wrapper;
}


function initializeMissions() {
  const all = Array.from({ length: 14 }, (_, i) =>
  `mission${String(i + 1).padStart(2, '0')}.png`
  );

  const shuffled = all.sort(() => 0.5 - Math.random());
  const common = shuffled.slice(0, 5);     // 共通5枚
  const secretA = shuffled[5];             // A軍の秘密ミッション
  const secretB = shuffled[6];             // B軍の秘密ミッション

  // 共通ミッションを保存
  firebase.database().ref("missions").set(common.map(filename => ({
    filename,
    cleared: false
  })));

  // 🔽 秘密ミッションを保存（←これが追加された重要ポイント！）
  firebase.database().ref("secretMissions").set({
    A: { filename: secretA, revealed: false },
    B: { filename: secretB, revealed: false }
  });
}


let unitInfo = {};

fetch('unit_data.json')
  .then(response => response.json())
  .then(data => {
    unitInfo = data;

    // ヘックスラベル表示
    showAllHexLabels();

    // チームAを選択状態にする
    selectTeam('A');

    // チームBのユニットリストを表示
    renderUnitList('B');

    // ミッションを表示
    showSharedMissions();

    // ユニットのリアルタイム同期
    firebase.database().ref("units").on("value", snapshot => {
      const units = snapshot.val();
      updateUnitsFromFirebase(units);
    });

    // ポイントAのリアルタイム監視
    firebase.database().ref("points/A").on("value", snapshot => {
      const val = snapshot.val();
      if (val !== null) {
        teamPoints.A = val;
        document.getElementById("pointA").textContent = val;
      }
    });

    // ポイントBのリアルタイム監視
    firebase.database().ref("points/B").on("value", snapshot => {
      const val = snapshot.val();
      if (val !== null) {
        teamPoints.B = val;
        document.getElementById("pointB").textContent = val;
      }
    });

    // リセットフラグ監視（ゲーム初期化時の処理）
    firebase.database().ref("resetFlag").on("value", snapshot => {
      if (snapshot.val()) {
        alert("ゲームが初期化されました。再ログインしてください。");

        // ローカル保存クリア
        localStorage.removeItem("playerID");
        playerInfo = null;

        // 表示をログイン画面に戻す
        document.getElementById("loginArea").style.display = "block";
        document.getElementById("gameArea").style.display = "none";
        document.getElementById("diceArea").style.display = "none";
        document.getElementById("missionArea").style.display = "none";

        // 画面の初期化
        document.getElementById("unitLayer").innerHTML = "";
        document.getElementById("diceResult").textContent = "-";
        document.getElementById("rollButton").disabled = false;

        occupiedCells.clear();
        occupiedUnits.clear();

        renderUnitList("A");
        renderUnitList("B");

        // フラグ削除
        firebase.database().ref("resetFlag").remove();
      }
    });

  });


function adjustPoint(team, delta) {
  teamPoints[team] += delta;
  if (teamPoints[team] < 0) teamPoints[team] = 0;
  document.getElementById(`point${team}`).textContent = teamPoints[team];

  // ✅ Firebaseに保存
  firebase.database().ref(`points/${team}`).set(teamPoints[team]);
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

firebase.database().ref("dice").on("value", (snapshot) => {
  const data = snapshot.val();

  if (!data) {
    // 🔁 リセットされたとき（全員に反映）
    document.getElementById("diceResult").textContent = "-";
    document.getElementById("rollButton").disabled = false;
    return;
  }

  // 🎲 サイコロを振ったとき（全員に出目を表示し、再振りを禁止）
  const result = data.value;
  document.getElementById("diceResult").textContent = result;
  document.getElementById("rollButton").disabled = true;
});


function resetDice() {
  firebase.database().ref("dice").set(null);  // Firebaseから削除

  // ローカル画面を初期化
  document.getElementById("diceResult").textContent = "-";
  document.getElementById("rollButton").disabled = false;
}

function updateUnitsFromFirebase(units) {
  const containerA = document.getElementById("unitListA");
  const containerB = document.getElementById("unitListB");
  containerA.innerHTML = "";
  containerB.innerHTML = "";

  occupiedUnits.clear();
  occupiedCells.clear();
  document.getElementById("unitLayer").innerHTML = "";
  clearUnitStatusPanels();

  for (const key in units) {
    const u = units[key];
    if (!u || !u.team || !u.filename || !u.cellNum) continue;

    if (/^unit\d{2}\.png$/.test(u.filename)) {
      occupiedUnits.add(u.filename);
    }

    occupiedCells.add(u.cellNum);

    const pos = getHexPixelPosition(u.cellNum);
    const img = document.createElement("img");
    img.src = `images/${u.filename}`;
    img.className = `unitOnMap ${u.team.toLowerCase()}`;
    img.style.left = `${pos.left}px`;
    img.style.top = `${pos.top}px`;
    img.dataset.unitid = u.unitID || key;
    document.getElementById("unitLayer").appendChild(img);

    if ((u.filename === "s_unit01.png" || u.filename === "s_unit02.png") && u.count > 1) {
      const label = document.createElement("div");
      label.className = "unitNumberLabel";
      label.innerText = `（${u.count}）`;
      label.style.left = `${pos.left}px`;
      label.style.top = `${pos.top - 20}px`;
      document.getElementById("unitLayer").appendChild(label);
    }

    // ✅ ユニットをクリック → サイコロ未振りなら全マス、振ってあれば出目で範囲制限
    img.addEventListener("click", () => {
      if (playerInfo && playerInfo.team !== u.team) return;

      const clickedUnitID = u.unitID || key;

      if (isMovingMode && movingUnit?.unitID === clickedUnitID) {
        clearMoveMode();
        return;
      }

      movingUnit = { img, filename: u.filename, unitID: clickedUnitID };
      isMovingMode = true;

      // 🎲 サイコロの出目を確認
      firebase.database().ref("dice/value").once("value").then(snapshot => {
        const rawDice = snapshot.val();

        if (rawDice === null) {
          // サイコロを振っていない → 全空きマスをハイライト
          document.querySelectorAll(".hexLabel").forEach(label => {
            const cell = Number(label.dataset.cellnum);
            label.classList.remove("highlight-move");

            if (!occupiedCells.has(cell) && !blockedCells.includes(cell)) {
              label.classList.add("highlight-move");
              label.onclick = () => {
                moveUnitToCell(movingUnit, cell);
                clearMoveMode();
              };
            } else {
              label.onclick = () => {
                clearMoveMode();
              };
            }
          });
        } else {
          // サイコロ振ってある → 出目に応じた移動範囲
          const diceVal = rawDice;
          const moveRange = unitInfo[u.filename]?.move?.[diceVal - 1] || 0;
          highlightMovableCells(u.cellNum, moveRange);
        }
      });
    });

    showUnitStatus(u.team, u.filename, u.count, u);
  }

  renderUnitList("A");
  renderUnitList("B");
}

function logout() {
  // ローカルデータの削除
  localStorage.removeItem("playerID");
  playerInfo = null;

  // ✅ 表示切替（共通関数を使用）
  toggleGameUI(false);
  document.getElementById("missionArea").innerHTML = "";

  // 選択状態のリセット
  selectedUnit = null;
  selectedTeam = null;
  clearSelectedUnit();

  // ✅ Firebaseのユニット監視を解除（これが今回のポイント！）
  firebase.database().ref("units").off("value");
}


function resetGameData() {
  if (!confirm("本当にすべてのプレイヤーとユニット情報を初期化しますか？")) return;

  firebase.database().ref("players").remove();
  firebase.database().ref("units").remove();
  firebase.database().ref("dice").remove();
  firebase.database().ref("points").remove();  // ここでポイントも削除
  firebase.database().ref("s_unitCounts").remove();
  firebase.database().ref("event").remove();  // イベントカード状態を初期化

  initializeMissions();

  firebase.database().ref("resetFlag").set(true);

  alert("ゲームデータを初期化しました。");

  sUnitCount["s_unit01.png"] = 0;
  sUnitCount["s_unit02.png"] = 0;

  // ローカルのポイントもリセット
  teamPoints.A = 0;
  teamPoints.B = 0;
  document.getElementById("pointA").textContent = "0";
  document.getElementById("pointB").textContent = "0";

  localStorage.removeItem("playerID");
  playerInfo = null;

  toggleGameUI(false);
  document.getElementById("unitLayer").innerHTML = "";
  document.getElementById("diceResult").textContent = "-";
  document.getElementById("rollButton").disabled = false;
  occupiedCells.clear();
  occupiedUnits.clear();
  renderUnitList("A");
  renderUnitList("B");
}


// 🎴 イベントカード関連の状態監視
firebase.database().ref("event").on("value", (snapshot) => {
  const data = snapshot.val();
  const container = document.getElementById("eventCardContainer");
  const triggerBtn = document.getElementById("eventTriggerBtn");
  const clearBtn = document.getElementById("eventClearBtn");

  container.innerHTML = "";

  if (!data || !data.current) {
    // 表示なし
    triggerBtn.disabled = false;
    clearBtn.disabled = true;
  } else {
    // 表示あり
    const img = document.createElement("img");
    img.src = `images/event/${data.current}`;
    img.className = "eventCard";
    container.appendChild(img);
    triggerBtn.disabled = true;
    clearBtn.disabled = false;
  }
});

function triggerEvent() {
  firebase.database().ref("event").once("value").then(snapshot => {
    const data = snapshot.val() || {};
    const used = data.used || [];
    const allCards = Array.from({ length: 30 }, (_, i) => `event${String(i + 1).padStart(2, '0')}.png`);
    const remaining = allCards.filter(card => !used.includes(card));

    let nextCard;
    if (remaining.length === 0) {
      // リセットして再スタート
      nextCard = allCards[Math.floor(Math.random() * allCards.length)];
      firebase.database().ref("event").set({
        current: nextCard,
        used: [nextCard]
      });
    } else {
      // 未使用からランダム選択
      nextCard = remaining[Math.floor(Math.random() * remaining.length)];
      firebase.database().ref("event").set({
        current: nextCard,
        used: [...used, nextCard]
      });
    }
  });
}

function clearEvent() {
  firebase.database().ref("event/current").remove();
}

// マス番号を (row, col) に変換（縦9マス × 横18列）
function getCellCoordinates(cellNum) {
  const index = cellNum - 1;
  const col = Math.floor(index / MAP_ROWS);
  const row = index % MAP_ROWS;
  return { row, col };
}

// 六角マス同士の距離を計算（オフセット→キューブ換算）
function getHexDistance(cellA, cellB) {
  const a = getCellCoordinates(cellA);
  const b = getCellCoordinates(cellB);

  const dx = b.col - a.col;
  const dy = b.row - a.row - Math.floor((b.col - a.col + (a.col % 2)) / 2);
  const dz = -dx - dy;

  return Math.max(Math.abs(dx), Math.abs(dy), Math.abs(dz));
}

function highlightMovableCells(startCellNum, moveRange) {
  clearMoveHighlights();  // まず前回のハイライトを消す

  const totalCells = MAP_ROWS * MAP_COLUMNS;
  for (let cellNum = 1; cellNum <= totalCells; cellNum++) {
    if (blockedCells.includes(cellNum)) continue;         // ブロックマスはスキップ
    if (occupiedCells.has(cellNum)) continue;             // すでに他ユニットがいる場合もスキップ

    const dist = getHexDistance(startCellNum, cellNum);
    if (dist <= moveRange) {
      const label = document.querySelector(`.hexLabel[data-cellnum="${cellNum}"]`);
      if (label) {
        label.classList.add("highlight-move");
        label.onclick = () => {
          moveUnitToCell(movingUnit, cellNum);
          clearMoveMode();
        };
      }
    }
  }
}
