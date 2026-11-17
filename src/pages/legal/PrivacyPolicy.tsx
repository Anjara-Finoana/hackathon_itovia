import { Link } from 'react-router-dom'
import './Legal.css'

export function PrivacyPolicy() {
  return (
    <div className="legal-page">
      <div className="legal-container">
        <header className="legal-header">
          <span className="legal-badge">Conformité & Transparence</span>
          <h1 className="legal-title">Politique de Confidentialité</h1>
          <p className="legal-meta">Dernière mise à jour : 18 novembre 2026 · OffRec Madagascar</p>
        </header>

        <article className="legal-card">
          <nav className="legal-toc" aria-label="Sommaire de la politique de confidentialité">
            <p className="legal-toc-title">Sommaire</p>
            <ul>
              <li><a href="#intro">1. Introduction et responsable de traitement</a></li>
              <li><a href="#data-collected">2. Données collectées sur OffRec</a></li>
              <li><a href="#google-api-policy">3. Utilisation des données des services API Google (Google Calendar & Meet)</a></li>
              <li><a href="#data-use">4. Finalités du traitement des données</a></li>
              <li><a href="#data-sharing">5. Partage et non-cession des données</a></li>
              <li><a href="#security">6. Sécurité et conservation des données</a></li>
              <li><a href="#user-rights">7. Vos droits et révocation des accès</a></li>
              <li><a href="#contact">8. Nous contacter</a></li>
            </ul>
          </nav>

          <section id="intro" className="legal-section">
            <h2>1. Introduction et responsable de traitement</h2>
            <p>
              La plateforme <strong>OffRec</strong> (accessible à l'adresse <code>https://offrec.ffn-tech.com</code>), éditée par Qualitec Madagascar, est un service d'offres et de recommandations professionnelles dédié aux talents et entreprises à Madagascar.
            </p>
            <p>
              La présente Politique de Confidentialité a pour objectif d'informer en toute transparence l'ensemble des utilisateurs (candidats, recruteurs, talents indépendants et visiteurs) sur la manière dont leurs données personnelles sont collectées, utilisées, protégées et conservées.
            </p>
          </section>

          <section id="data-collected" className="legal-section">
            <h2>2. Données collectées sur OffRec</h2>
            <p>Dans le cadre de l'utilisation de nos services, nous sommes amenés à collecter les catégories de données suivantes :</p>
            <ul>
              <li><strong>Informations d'authentification et de compte</strong> : nom, prénom, adresse email, mot de passe chiffré (bcrypt), rôle sur la plateforme.</li>
              <li><strong>Données professionnelles des candidats et talents</strong> : curriculum vitæ (CV), compétences, niveau d'expérience, prétentions salariales indicatives, historique des recommandations professionnelles.</li>
              <li><strong>Données des entreprises et recruteurs</strong> : raison sociale, secteur d'activité, localisation, descriptions des postes et offres d'emploi déposées.</li>
              <li><strong>Données d'organisation d'entretiens</strong> : créneaux horaires, dates retenues, durée et statut des entretiens de recrutement.</li>
            </ul>
          </section>

          <section id="google-api-policy" className="legal-section">
            <h2>3. Utilisation des données des services API Google (Google Calendar & Google Meet)</h2>
            <p>
              OffRec intègre l'API Google Calendar (champ d'application <code>https://www.googleapis.com/auth/calendar.events</code>) afin de faciliter la planification des entretiens de recrutement et la génération automatique de salles de visioconférence sécurisées via <strong>Google Meet</strong>.
            </p>

            <div className="legal-highlight-box">
              <h4>Conformité à la politique d'utilisation des données Google</h4>
              <p>
                L'utilisation et le transfert par OffRec à toute autre application des informations reçues des API Google respecteront strictement les <a href="https://developers.google.com/terms/api-services-user-data-policy" target="_blank" rel="noopener noreferrer">Règles relatives aux données utilisateur des services d'API Google (Google API Services User Data Policy)</a>, y compris les exigences d'<strong>Utilisation Limitée (Limited Use)</strong>.
              </p>
            </div>

            <h3>Engagements stricts d'OffRec concernant les données Google :</h3>
            <ul>
              <li><strong>Usage exclusivement fonctionnel</strong> : L'accès à Google Calendar est strictement limité à la création, mise à jour ou suppression programmée des événements d'entretiens fixés sur la plateforme OffRec, ainsi qu'à la génération du lien Google Meet associé.</li>
              <li><strong>Préservation stricte de la confidentialité (Aucun invité Google)</strong> : Les événements créés dans l'agenda d'OffRec n'ajoutent <em>aucun invité externe (attendees)</em>. Google n'envoie aucun email automatique et n'expose jamais les coordonnées du candidat au recruteur ou inversement. OffRec transmet lui-même le lien Google Meet de manière sécurisée et cloisonnée à chaque partie.</li>
              <li><strong>Pas de publicité</strong> : Vos données Google ne sont jamais utilisées à des fins publicitaires, promotionnelles ou de profilage commercial.</li>
              <li><strong>Pas de revente ni de transfert</strong> : OffRec ne vend, ne loue, ni ne transfère aucune donnée issue de Google à des tiers ou courtiers de données.</li>
              <li><strong>Pas d'entraînement d'IA généraliste</strong> : Les données issues des services API Google ne sont en aucun cas utilisées pour entraîner des modèles d'intelligence artificielle généralistes ou tiers.</li>
            </ul>
          </section>

          <section id="data-use" className="legal-section">
            <h2>4. Finalités du traitement des données</h2>
            <p>Vos données personnelles sont traitées exclusivement pour les finalités suivantes :</p>
            <ul>
              <li>Mise en relation professionnelle pertinente entre candidats et employeurs à Madagascar.</li>
              <li>Gestion et suivi des entretiens d'embauche et transmission des liens de visioconférence Google Meet.</li>
              <li>Vérification et authentification des profils et compétences déclarées.</li>
              <li>Envoi des notifications relatives aux dossiers et statuts d'entretien (par email et sur l'interface).</li>
            </ul>
          </section>

          <section id="data-sharing" className="legal-section">
            <h2>5. Partage et non-cession des données</h2>
            <p>
              Les profils des candidats ne sont transmis aux recruteurs qu'avec leur consentement explicite dans le cadre du processus de mise en relation. Nous ne commercialisons aucune base de données utilisateurs. Les prestataires techniques intervenant pour l'hébergement et l'infrastructure sont tenus à des obligations contractuelles strictes de confidentialité et de sécurité.
            </p>
          </section>

          <section id="security" className="legal-section">
            <h2>6. Sécurité et conservation des données</h2>
            <p>
              Nous mettons en œuvre des mesures techniques et organisationnelles conformes aux standards de l'industrie pour protéger vos données :
            </p>
            <ul>
              <li>Chiffrement systématique de toutes les communications en transit via le protocole TLS/HTTPS (certificats SSL stricts).</li>
              <li>Stockage sécurisé des mots de passe par hachage cryptographique robuste (bcrypt).</li>
              <li>Sessions sécurisées par cookies HttpOnly, SameSite et signés pour prévenir les attaques CSRF et XSS.</li>
              <li>Conservation des données limitée à la durée nécessaire aux finalités pour lesquelles elles ont été collectées ou conformément aux obligations légales applicables.</li>
            </ul>
          </section>

          <section id="user-rights" className="legal-section">
            <h2>7. Vos droits et révocation des accès</h2>
            <p>
              Conformément à la réglementation applicable en matière de protection des données personnelles, vous disposez à tout moment d'un droit d'accès, de rectification, de portabilité et de suppression de vos données personnelles.
            </p>
            <p>
              <strong>Révocation de l'accès Google</strong> : Si vous avez accordé à OffRec l'accès à votre compte Google pour la synchronisation d'agenda, vous pouvez révoquer cette autorisation à tout moment en visitant la page officielle de sécurité Google : <a href="https://myaccount.google.com/permissions" target="_blank" rel="noopener noreferrer">Gérer les autorisations tierces de votre compte Google</a>.
            </p>
          </section>

          <section id="contact" className="legal-section">
            <h2>8. Nous contacter</h2>
            <p>
              Pour toute question relative à la présente politique de confidentialité ou pour exercer vos droits d'accès et de suppression, vous pouvez contacter notre équipe par email ou par téléphone :
            </p>
            <div className="legal-contact-box">
              <p><strong>OffRec — Qualitec Madagascar</strong></p>
              <p>Email officiel : <a href="mailto:contact@qualitec.mg">contact@qualitec.mg</a> / <a href="mailto:whartonaldrick@gmail.com">whartonaldrick@gmail.com</a></p>
              <p>Téléphone : +261 38 64 234 49 · +261 34 50 305 27</p>
              <p>Adresse : Antananarivo, Madagascar</p>
            </div>
            <p style={{ marginTop: '1.5rem' }}>
              <Link to="/">← Retour à l’accueil OffRec</Link> · <Link to="/conditions-d-utilisation">Consulter les Conditions d’utilisation</Link>
            </p>
          </section>
        </article>
      </div>
    </div>
  )
}
