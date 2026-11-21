import { useEffect, useState } from 'react'
import {
  AlertCircle,
  Bot,
  Calendar,
  CheckCircle2,
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

  const [inputMode, setInputMode] = useState<'upload' | 'paste'>('upload')
  const [sessionJsonText, setSessionJsonText] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [disconnecting, setDisconnecting] = useState(false)

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

      {/* SECTION MISE À JOUR OU TÉLÉVERSEMENT */}
      <div className="admin-bot-update-section">
        <h2 className="text-lg font-semibold text-slate-900 mb-2 flex items-center gap-2">
          <UploadCloud className="w-5 h-5 text-emerald-600" />
          Mettre à jour ou configurer la session Google
        </h2>
        <p className="text-sm text-slate-600 mb-4">
          Vous pouvez importer un fichier <code className="bg-slate-100 px-1 py-0.5 rounded text-xs">google-session.json</code> généré localement pour changer le compte du bot à tout moment sans SSH.
        </p>

        <div className="admin-bot-tabs">
          <button
            type="button"
            className={`admin-bot-tab ${inputMode === 'upload' ? 'admin-bot-tab--active' : ''}`}
            onClick={() => setInputMode('upload')}
          >
            <UploadCloud className="w-4 h-4 mr-1.5" />
            Téléverser un fichier
          </button>
          <button
            type="button"
            className={`admin-bot-tab ${inputMode === 'paste' ? 'admin-bot-tab--active' : ''}`}
            onClick={() => setInputMode('paste')}
          >
            <FileCode className="w-4 h-4 mr-1.5" />
            Coller le JSON
          </button>
        </div>

        {inputMode === 'upload' ? (
          <div className="admin-bot-dropzone">
            <UploadCloud className="w-10 h-10 text-slate-400 mb-2" />
            <p className="text-sm font-medium text-slate-700">
              Déposez votre fichier <span className="font-mono text-emerald-600">google-session.json</span>
            </p>
            <p className="text-xs text-slate-400 mt-1 mb-3">ou cliquez pour parcourir vos fichiers</p>
            <input
              type="file"
              id="session-upload-input"
              accept=".json,application/json"
              className="hidden"
              onChange={handleFileUpload}
              disabled={submitting}
            />
            <label htmlFor="session-upload-input">
              <span className="inline-flex items-center px-4 py-2 text-sm font-medium text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-md cursor-pointer hover:bg-emerald-100">
                {submitting ? 'Envoi en cours...' : 'Sélectionner le fichier'}
              </span>
            </label>
          </div>
        ) : (
          <form onSubmit={handlePasteSubmit} className="admin-bot-paste-form">
            <textarea
              className="admin-bot-textarea font-mono text-xs"
              rows={8}
              placeholder="Collez ici le contenu JSON complet de google-session.json (cookies et storageState Playwright)..."
              value={sessionJsonText}
              onChange={(e) => setSessionJsonText(e.target.value)}
              disabled={submitting}
            />
            <div className="mt-2 flex justify-end">
              <Button type="submit" disabled={submitting || !sessionJsonText.trim()}>
                {submitting ? 'Enregistrement...' : 'Enregistrer la session'}
              </Button>
            </div>
          </form>
        )}
      </div>

      {/* SECTION PROCÉDURE RAPIDE */}
      <div className="admin-bot-guide">
        <h3 className="text-sm font-bold text-slate-800 flex items-center gap-1.5 mb-2">
          <Terminal className="w-4 h-4 text-slate-600" />
          Procédure rapide : Connexion locale en 1 clic
        </h3>
        <ol className="text-xs text-slate-600 space-y-1.5 list-decimal list-inside leading-relaxed">
          <li>
            Sur votre machine de développement, exécutez la commande :
            <pre className="inline-block mx-1.5 px-2 py-0.5 bg-slate-900 text-emerald-400 font-mono rounded text-xs">
              npm run bot:login
            </pre>
          </li>
          <li>
            Une fenêtre Chromium s'ouvre : connectez-vous avec{' '}
            <strong className="text-slate-800">nomade.wanderer.2002@gmail.com</strong>.
          </li>
          <li>
            Dès validation, le script génère automatiquement le fichier et peut le téléverser directement sur OffRec, ou vous pouvez glisser le fichier généré dans cette page.
          </li>
        </ol>
      </div>
    </div>
  )
}

export default AdminAgentBot
