const out = document.getElementById("out");
async function refresh() { out.textContent = JSON.stringify(await window.dsh.projection(), null, 2); }
document.getElementById("go").addEventListener("click", async () => {
  await window.dsh.append("user/message", "clicked at " + new Date().toISOString());
  await refresh();
});
refresh().catch((e) => { out.textContent = "失败: " + e.message; });
