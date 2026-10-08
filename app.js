// 화면 담당: Cloudflare의 /api/parking에 요청하고 목록을 표시합니다.
// 공공데이터 인증키는 이 파일에 넣지 않습니다.
const loadButton = document.getElementById("load-button");
const statusText = document.getElementById("status");
const parkingList = document.getElementById("parking-list");

async function loadParkingList() {
  loadButton.disabled = true;
  parkingList.setAttribute("aria-busy", "true");
  statusText.className = "";
  statusText.textContent = "주차장 목록을 불러오는 중입니다.";

  try {
    const response = await fetch("/api/parking", {
      cache: "no-store",
      signal: AbortSignal.timeout(20000)
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.message || "목록을 불러오지 못했습니다.");
    if (!Array.isArray(data.parkingList)) throw new Error("응답 형식을 확인해 주세요.");

    const fragment = document.createDocumentFragment();
    for (const parking of data.parkingList) {
      const item = document.createElement("li");
      const code = document.createElement("span");
      code.className = "parking-code";
      code.textContent = parking.parkgcd;
      const name = document.createElement("span");
      name.textContent = parking.parknm;
      item.append(code, name);
      fragment.append(item);
    }
    parkingList.replaceChildren(fragment);
    statusText.textContent = data.parkingList.length
      ? `주차장 ${data.parkingList.length}곳을 불러왔습니다.`
      : "조회된 주차장이 없습니다.";
  } catch (error) {
    statusText.className = "error";
    statusText.textContent = error.name === "TimeoutError"
      ? "응답이 지연되고 있습니다. 잠시 후 다시 시도해 주세요."
      : error.message;
    if (parkingList.children.length) statusText.textContent += " 이전 목록을 유지합니다.";
  } finally {
    loadButton.disabled = false;
    parkingList.setAttribute("aria-busy", "false");
  }
}
loadButton.addEventListener("click", loadParkingList);
