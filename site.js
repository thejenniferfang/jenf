// Theme toggle. The stored choice wins over the system setting, and the head
// script has already applied it before first paint, so this only builds the
// control and keeps the two in sync.
;(() => {
  const root = document.documentElement
  const media = window.matchMedia("(prefers-color-scheme: dark)")
  const stored = () => {
    try {
      return localStorage.getItem("theme")
    } catch {
      return null
    }
  }
  const current = () => root.dataset.theme || (media.matches ? "dark" : "light")

  const button = document.createElement("button")
  button.id = "theme-toggle"
  button.type = "button"

  const label = () => {
    const next = current() === "dark" ? "light" : "dark"
    button.textContent = next === "dark" ? "Dark" : "Light"
    button.setAttribute("aria-label", `Switch to ${next} mode`)
  }

  button.addEventListener("click", () => {
    const next = current() === "dark" ? "light" : "dark"
    root.dataset.theme = next
    try {
      localStorage.setItem("theme", next)
    } catch {
      // A private window can refuse to store. The choice still holds for this page.
    }
    label()
  })

  // Following the system only makes sense while nothing has been chosen here.
  media.addEventListener("change", () => {
    if (!stored()) {
      delete root.dataset.theme
      label()
    }
  })

  label()
  document.body.appendChild(button)
})()
