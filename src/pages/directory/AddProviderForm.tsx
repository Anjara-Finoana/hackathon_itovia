import { useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'
import { Button } from '../../components/ui/Button'
import { Card } from '../../components/ui/Card'
import { Field, Input, Select, Textarea } from '../../components/ui/Form'
import { DISTRICTS, TRADES } from '../../data/constants'
import { useApp } from '../../context/AppContext'
import './Directory.css'

/**
 * Ajout d'un professionnel à l'annuaire — réservé à l'administrateur
 * (route protégée `role="admin"`, garde serveur `requireRole('admin')`).
 * Les autres rôles recommandent ou confirment des professionnels déjà listés.
 */
export function AddProviderForm() {
  const navigate = useNavigate()
  const { addProvider } = useApp()

  const [name, setName] = useState('')
  const [trade, setTrade] = useState('')
  const [district, setDistrict] = useState('')
  const [phone, setPhone] = useState('')
  const [whatsapp, setWhatsapp] = useState('')
  const [description, setDescription] = useState('')
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [formError, setFormError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const validate = (): boolean => {
    const next: Record<string, string> = {}
    if (name.trim().length < 2) next.name = 'Indiquez le nom du professionnel ou de l’entreprise.'
    if (!trade) next.trade = 'Choisissez un métier.'
    if (!district) next.district = 'Choisissez le quartier.'
    if (phone.replace(/\s/g, '').length < 6) next.phone = 'Numéro de téléphone invalide.'
    setErrors(next)
    return Object.keys(next).length === 0
  }

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setFormError('')
    if (!validate()) return
    setSubmitting(true)
    const result = await addProvider(
      {
        name: name.trim(),
        trade,
        district,
        city: 'Antananarivo',
        province: 'Antananarivo',
        phone: phone.trim(),
        whatsapp: whatsapp.trim() || undefined,
        description: description.trim(),
      },
      district,
    )
    setSubmitting(false)
    if (!result.ok || !result.provider) {
      setFormError(result.error ?? 'Ajout du professionnel impossible.')
      return
    }
    navigate(`/annuaire/${result.provider.id}`)
  }

  return (
    <div className="page">
      <div className="container dir-detail dir-form-page">
        <Link to="/annuaire" className="dir-back">
          <ArrowLeft size={16} aria-hidden />
          Retour à l’annuaire
        </Link>

        <header className="page-header">
          <h1>Ajouter un professionnel</h1>
          <p>
            La fiche apparaît dans l’onglet « Professionnels » de l’annuaire. Son score de confiance ne
            dépend que des recommandations que les membres publieront ensuite.
          </p>
        </header>

        <Card>
          <form onSubmit={handleSubmit} className="dir-form" noValidate>
            <Field label="Nom du professionnel ou de l’entreprise" error={errors.name}>
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Briqueterie d’Alasora" />
            </Field>

            <div className="dir-form-row">
              <Field label="Métier" error={errors.trade}>
                <Select value={trade} onChange={(e) => setTrade(e.target.value)}>
                  <option value="">Choisir…</option>
                  {TRADES.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </Select>
              </Field>

              <Field label="Quartier" error={errors.district}>
                <Select value={district} onChange={(e) => setDistrict(e.target.value)}>
                  <option value="">Choisir…</option>
                  {DISTRICTS.map((d) => (
                    <option key={d} value={d}>
                      {d}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>

            <div className="dir-form-row">
              <Field label="Téléphone professionnel" error={errors.phone}>
                <Input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="034 00 000 00" />
              </Field>

              <Field label="WhatsApp" hint="Facultatif.">
                <Input type="tel" value={whatsapp} onChange={(e) => setWhatsapp(e.target.value)} />
              </Field>
            </div>

            <Field label="Description" hint="Facultatif : prestations, zone d’intervention.">
              <Textarea rows={4} value={description} onChange={(e) => setDescription(e.target.value)} />
            </Field>

            {formError && <p className="dir-guard">{formError}</p>}

            <Button type="submit" size="lg" fullWidth disabled={submitting}>
              {submitting ? 'Ajout en cours…' : 'Ajouter le professionnel'}
            </Button>
          </form>
        </Card>
      </div>
    </div>
  )
}
