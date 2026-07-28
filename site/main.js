const btn = document.querySelector('.term .copy')
const cmd = document.getElementById('install-cmd')

btn?.addEventListener('click', async () => {
  const text = cmd?.textContent?.trim()
  if (!text) return
  try {
    await navigator.clipboard.writeText(text)
    btn.textContent = 'COPIED ✓'
    btn.classList.add('ok')
    setTimeout(() => {
      btn.textContent = 'COPY'
      btn.classList.remove('ok')
    }, 1600)
  } catch {
    btn.textContent = 'SELECT & COPY'
  }
})
