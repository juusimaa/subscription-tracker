import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.jsx'
import { LanguageRoot } from './Language.jsx'

// LanguageRoot takes a function so a change of language renders a fresh <App>
// element, and with it every string on the page (see src/i18n.js).
createRoot(document.getElementById('root')).render(
  <StrictMode>
    <LanguageRoot>{() => <App />}</LanguageRoot>
  </StrictMode>,
)
