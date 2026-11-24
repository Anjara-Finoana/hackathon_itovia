import { useEffect, useState } from 'react'
import {
  AlertCircle,
  Bot,
  Calendar,
  Check,
  CheckCircle2,
  Copy,
  FileCode,
  RefreshCw,
  Terminal,
  Trash2,
  UploadCloud,
  Users,
} from 'lucide-react'
import { Button } from '../../components/ui/Button'
import { Loading } from '../../components/ui/Loading'
import {
  apiAdminBotDisconnect,
  apiAdminBotStatus,
  apiAdminBotUpdateSession,
  type AdminBotStatus,
} from '../../lib/api'
import './AdminAgentBot.css'

export function AdminAgentBot() {
  const [data, setData] = useState<AdminBotStatus | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [successMsg, setSuccessMsg] = useState<string | null>(null)

  const [inputMode, setInputMode] = useState<'paste' | 'upload'>('paste')
  const [osTab, setOsTab] = useState<'unix' | 'windows'>('unix')
  const [copiedCmd, setCopiedCmd] = useState(false)
  const [sessionJsonText, setSessionJsonText] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [disconnecting, setDisconnecting] = useState(false)

  const origin = typeof window !== 'undefined' ? window.location.origin : 'https://offrec.ffn-tech.com'
  const scriptUrl = `${origin}/bot-login.mjs`
  const terminalCommand =
    osTab === 'unix'
      ? `curl -sSL ${scriptUrl} -o /tmp/offrec-bot-login.mjs && node /tmp/offrec-bot-login.mjs`
      : `irm ${scriptUrl} -OutFile $env:TEMP\\offrec-bot-login.mjs; node $env:TEMP\\offrec-bot-login.mjs`

  const handleCopyCommand = async () => {
    try {
      await navigator.clipboard.writeText(terminalCommand)
      setCopiedCmd(true)
      setTimeout(() => setCopiedCmd(false), 2500)
    } catch {
      setError('Impossible de copier automatiquement. Sélectionnez et copiez la commande manuellement.')
    }
  }

  const loadStatus = async () => {
    try {
      setLoading(true)
      setError(null)
      const res = await apiAdminBotStatus()
      setData(res)
    } catch (err) {
      setError((err as Error).message || 'Impossible de contacter le service')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadStatus()
  }, [])

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    const reader = new FileReader()
    reader.onload = async (event) => {
      try {
        const text = event.target?.result as string
        const parsed = JSON.parse(text)
        await submitSession(parsed)
      } catch (err) {
        setError('Le fichier sélectionné n’est pas un JSON valide : ' + (err as Error).message)
      }
    }
    reader.readAsText(file)
  }

  const handlePasteSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!sessionJsonText.trim()) return

    try {
      const parsed = JSON.parse(sessionJsonText.trim())
      await submitSession(parsed)
      setSessionJsonText('')
    } catch (err) {
      setError('JSON invalide : ' + (err as Error).message)
    }
  }

  const submitSession = async (storageState: unknown) => {
    try {
      setSubmitting(true)
      setError(null)
      setSuccessMsg(null)

      const res = await apiAdminBotUpdateSession(storageState)
      setSuccessMsg(res.message || 'Session Google mise à jour avec succès !')
      await loadStatus()
    } catch (err) {
      setError((err as Error).message || 'Échec de la mise à jour')
    } finally {
      setSubmitting(false)
    }
  }

  const handleDisconnect = async () => {
    if (!window.confirm('Voulez-vous vraiment déconnecter et supprimer la session Google du bot ?')) {
      return
    }

    try {
      setDisconnecting(true)
      setError(null)
      setSuccessMsg(null)

      const res = await apiAdminBotDisconnect()
      setSuccessMsg(res.message || 'Session supprimée avec succès')
      await loadStatus()
    } catch (err) {
      setError((err as Error).message || 'Échec de la déconnexion')
    } finally {
      setDisconnecting(false)
    }
  }

  return (
    <div className="admin-bot-page">
      <div className="admin-bot-header">
        <div>
          <h1 className="admin-bot-title">
            <Bot className="w-7 h-7 text-emerald-600 inline-block mr-2" />
            Agent Visioconférence (Finoana Scribe)
          </h1>
          <p className="admin-bot-subtitle">
            Gestion de l’authentification Google pour l’accès automatique aux réunions Google Meet sans blocage IP.
          </p>
        </div>
        <div className="admin-bot-actions">
          <Button variant="outline" size="sm" onClick={loadStatus} disabled={loading}>
            <RefreshCw className={`w-4 h-4 mr-1 ${loading ? 'animate-spin' : ''}`} />
            Actualiser
          </Button>
        </div>
      </div>

      {error && (
        <div className="admin-bot-alert admin-bot-alert--error">
          <AlertCircle className="w-5 h-5 flex-shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {successMsg && (
        <div className="admin-bot-alert admin-bot-alert--success">
          <CheckCircle2 className="w-5 h-5 flex-shrink-0" />
          <span>{successMsg}</span>
        </div>
      )}

      {loading && !data ? (
        <div className="admin-bot-loading">
          <Loading />
        </div>
      ) : (
        <div className="admin-bot-grid">
          {/* CARTE 1 : SESSION GOOGLE DU BOT */}
          <div className="admin-bot-card">
            <div className="admin-bot-card-header">
              <div className="admin-bot-card-title">
                <Bot className="w-5 h-5 text-emerald-600" />
                <span>Session Google de l'Agent</span>
              </div>
              {data?.bot.configured ? (
                <span className="admin-bot-badge admin-bot-badge--green">
                  <CheckCircle2 className="w-3.5 h-3.5 mr-1" />
                  Connecté
                </span>
              ) : (
                <span className="admin-bot-badge admin-bot-badge--red">
                  <AlertCircle className="w-3.5 h-3.5 mr-1" />
                  Non configuré
                </span>
              )}
            </div>

            <div className="admin-bot-card-body">
              <div className="admin-bot-info-row">
                <span className="admin-bot-info-label">Compte Google actif :</span>
                <span className="admin-bot-info-value font-mono">
                  {data?.bot.accountHint || 'nomade.wanderer.2002@gmail.com'}
                </span>
              </div>

              <div className="admin-bot-info-row">
                <span className="admin-bot-info-label">Dernière mise à jour :</span>
                <span className="admin-bot-info-value">
                  {data?.bot.updatedAt
                    ? new Date(data.bot.updatedAt).toLocaleString('fr-FR')
                    : 'Aucun fichier enregistré'}
                </span>
              </div>

              <div className="admin-bot-info-row">
                <span className="admin-bot-info-label">Emplacement fichier :</span>
                <span className="admin-bot-info-value font-mono text-xs">
                  {data?.bot.authFile || '/app/bot/auth/google-session.json'}
                </span>
              </div>

              {data?.bot.cookiesCount !== undefined && (
                <div className="admin-bot-info-row">
                  <span className="admin-bot-info-label">Cookies enregistrés :</span>
                  <span className="admin-bot-info-value">{data.bot.cookiesCount} cookies Google</span>
                </div>
              )}

              {data?.bot.configured && (
                <div className="admin-bot-card-footer mt-4">
                  <Button
                    variant="outline"
                    size="sm"
                    className="text-red-600 border-red-200 hover:bg-red-50"
                    onClick={handleDisconnect}
                    disabled={disconnecting}
                  >
                    <Trash2 className="w-4 h-4 mr-1" />
                    {disconnecting ? 'Suppression...' : 'Déconnecter la session'}
                  </Button>
                </div>
              )}
            </div>
          </div>

          {/* CARTE 2 : AGENDA GOOGLE RECRUTEUR */}
          <div className="admin-bot-card">
            <div className="admin-bot-card-header">
              <div className="admin-bot-card-title">
                <Calendar className="w-5 h-5 text-indigo-600" />
                <span>Agenda Recruteur & Invité Meet</span>
              </div>
              {data?.calendar.configured ? (
                <span className="admin-bot-badge admin-bot-badge--green">
                  <CheckCircle2 className="w-3.5 h-3.5 mr-1" />
                  Actif
                </span>
              ) : (
                <span className="admin-bot-badge admin-bot-badge--yellow">
                  <AlertCircle className="w-3.5 h-3.5 mr-1" />
                  Incomplet
                </span>
              )}
            </div>

            <div className="admin-bot-card-body">
              <div className="admin-bot-info-row">
                <span className="admin-bot-info-label">Compte Organisateur :</span>
                <span className="admin-bot-info-value font-mono">
                  {data?.calendar.organizerAccount || 'lumine.aether.us@gmail.com'}
                </span>
              </div>

              <div className="admin-bot-info-row">
                <span className="admin-bot-info-label">Invité automatique (Bot) :</span>
                <span className="admin-bot-info-value font-mono">
                  {data?.calendar.botAttendeeEmail || 'nomade.wanderer.2002@gmail.com'}
                </span>
              </div>

              <p className="text-xs text-slate-500 mt-3 leading-relaxed">
                Les liens Google Meet créés par OffRec ajoutent automatiquement l'adresse du bot en invité de confiance.
                Combiné à sa session authentifiée, Google autorise son entrée immédiate sans blocage de datacenter.
              </p>
            </div>
          </div>

          {/* CARTE 3 : CONCURRENCE ET SESSIONS EN COURS */}
          <div className="admin-bot-card">
            <div className="admin-bot-card-header">
              <div className="admin-bot-card-title">
                <Users className="w-5 h-5 text-blue-600" />
                <span>Activité & Concurrence</span>
              </div>
              <span className="admin-bot-badge admin-bot-badge--blue">
                {data?.bot.activeBotsCount || 0} session(s) active(s)
              </span>
            </div>

            <div className="admin-bot-card-body">
              {data?.bot.activeSessions && data.bot.activeSessions.length > 0 ? (
                <div className="admin-bot-sessions-list">
                  {data.bot.activeSessions.map((s) => (
                    <div key={s.id} className="admin-bot-session-item">
                      <span className="font-mono text-xs">{s.id}</span>
                      <span className="admin-bot-badge admin-bot-badge--gray">{s.status}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-slate-500 py-4 text-center">
                  Aucun bot actuellement déployé dans un appel.
                </p>
              )}
            </div>
          </div>
        </div>
      )}

      {/* SECTION PROCÉDURE RAPIDE COPIER-COLLER */}
      <div className="admin-bot-guide">
        <div className="admin-bot-guide-header">
          <h2 className="admin-bot-section-title">
            <Terminal size={20} className="admin-bot-icon-emerald" />
            Générer la session Google depuis votre terminal (sans cloner le dépôt)
          </h2>
          <div className="admin-bot-os-switch">
            <button
              type="button"
              className={`admin-bot-os-btn ${osTab === 'unix' ? 'admin-bot-os-btn--active' : ''}`}
              onClick={() => setOsTab('unix')}
            >
              Linux / macOS
            </button>
            <button
              type="button"
              className={`admin-bot-os-btn ${osTab === 'windows' ? 'admin-bot-os-btn--active' : ''}`}
              onClick={() => setOsTab('windows')}
            >
              Windows (PowerShell)
            </button>
          </div>
        </div>

        <ol className="admin-bot-steps">
          <li>
            <span>Copiez et collez cette commande dans votre terminal (nécessite uniquement Node.js) :</span>
            <div className="admin-bot-cmd-box">
              <code className="admin-bot-cmd-code">{terminalCommand}</code>
              <button
                type="button"
                className="admin-bot-copy-btn"
                onClick={handleCopyCommand}
                title="Copier la commande"
              >
                {copiedCmd ? (
                  <>
                    <Check size={14} />
                    <span>Copié !</span>
                  </>
                ) : (
                  <>
                    <Copy size={14} />
                    <span>Copier</span>
                  </>
                )}
              </button>
            </div>
          </li>
          <li>
            <span>
              Une fenêtre navigateur s'ouvre : connectez-vous avec le compte Google souhaité (ex.{' '}
              <strong>nomade.wanderer.2002@gmail.com</strong>).
            </span>
          </li>
          <li>
            <span>
              Revenez sur le terminal : le JSON est affiché (et copié dans votre presse-papier si possible), et un fichier{' '}
              <code className="admin-bot-inline-code">google-session.json</code> est également créé.
            </span>
          </li>
          <li>
            <span>Collez ce JSON dans le formulaire ci-dessous (ou déposez le fichier) puis cliquez sur Enregistrer.</span>
          </li>
        </ol>
      </div>

      {/* SECTION MISE À JOUR OU TÉLÉVERSEMENT */}
      <div className="admin-bot-update-section">
        <h2 className="admin-bot-section-title">
          <UploadCloud size={20} className="admin-bot-icon-emerald" />
          Mettre à jour ou configurer la session Google
        </h2>
        <p className="admin-bot-section-desc">
          Collez le JSON généré par le terminal ou importez le fichier{' '}
          <code className="admin-bot-inline-code">google-session.json</code> pour changer le compte du bot à chaud.
        </p>

        <div className="admin-bot-tabs">
          <button
            type="button"
            className={`admin-bot-tab ${inputMode === 'paste' ? 'admin-bot-tab--active' : ''}`}
            onClick={() => setInputMode('paste')}
          >
            <FileCode size={16} />
            <span>Coller le JSON</span>
          </button>
          <button
            type="button"
            className={`admin-bot-tab ${inputMode === 'upload' ? 'admin-bot-tab--active' : ''}`}
            onClick={() => setInputMode('upload')}
          >
            <UploadCloud size={16} />
            <span>Téléverser un fichier</span>
          </button>
        </div>

        {inputMode === 'paste' ? (
          <form onSubmit={handlePasteSubmit} className="admin-bot-paste-form">
            <textarea
              className="admin-bot-textarea"
              rows={7}
              placeholder='Collez ici le JSON généré dans votre terminal (commençant par {"cookies":...)...'
              value={sessionJsonText}
              onChange={(e) => setSessionJsonText(e.target.value)}
              disabled={submitting}
            />
            <div className="admin-bot-form-actions">
              <Button type="submit" disabled={submitting || !sessionJsonText.trim()}>
                {submitting ? 'Enregistrement...' : 'Enregistrer la session'}
              </Button>
            </div>
          </form>
        ) : (
          <div className="admin-bot-dropzone">
            <UploadCloud size={36} className="admin-bot-dropzone-icon" />
            <p className="admin-bot-dropzone-title">
              Déposez votre fichier <span className="admin-bot-inline-code">google-session.json</span>
            </p>
            <p className="admin-bot-dropzone-hint">ou cliquez ci-dessous pour parcourir vos fichiers</p>
            <input
              type="file"
              id="session-upload-input"
              accept=".json,application/json"
              className="admin-bot-file-input"
              onChange={handleFileUpload}
              disabled={submitting}
            />
            <label htmlFor="session-upload-input" className="admin-bot-upload-btn">
              {submitting ? 'Envoi en cours...' : 'Sélectionner le fichier'}
            </label>
          </div>
        )}
      </div>
    </div>
  )
}

export default AdminAgentBot
