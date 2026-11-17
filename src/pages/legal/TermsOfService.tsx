import { Link } from 'react-router-dom'
import './Legal.css'

export function TermsOfService() {
  return (
    <div className="legal-page">
      <div className="legal-container">
        <header className="legal-header">
          <span className="legal-badge">Cadre Juridique</span>
          <h1 className="legal-title">Conditions Générales d’Utilisation</h1>
          <p className="legal-meta">Dernière mise à jour : 18 novembre 2026 · OffRec Madagascar</p>
        </header>

        <article className="legal-card">
          <nav className="legal-toc" aria-label="Sommaire des conditions générales d'utilisation">
            <p className="legal-toc-title">Sommaire</p>
            <ul>
              <li><a href="#objet">1. Objet et champ d'application</a></li>
              <li><a href="#services">2. Description des services OffRec</a></li>
              <li><a href="#accounts">3. Inscription et sécurité des comptes</a></li>
              <li><a href="#rules-candidates">4. Engagements des candidats et talents</a></li>
              <li><a href="#rules-recruiters">5. Engagements des entreprises et recruteurs</a></li>
              <li><a href="#interviews">6. Organisation des entretiens et visioconférences</a></li>
              <li><a href="#ip">7. Propriété intellectuelle</a></li>
              <li><a href="#liability">8. Responsabilité et disponibilité</a></li>
              <li><a href="#law">9. Droit applicable et juridiction compétente</a></li>
            </ul>
          </nav>

          <section id="objet" className="legal-section">
            <h2>1. Objet et champ d'application</h2>
            <p>
              Les présentes Conditions Générales d’Utilisation (ci-après les « CGU ») ont pour objet d’encadrer l’accès et l’utilisation de la plateforme web <strong>OffRec</strong> accessible à l'adresse <code>https://offrec.ffn-tech.com</code>.
            </p>
            <p>
              Toute navigation sur le site ou utilisation d’un compte utilisateur (candidat, talent, entreprise recruteuse, agent ou particulier) emporte acceptation pleine et entière des présentes CGU.
            </p>
          </section>

          <section id="services" className="legal-section">
            <h2>2. Description des services OffRec</h2>
            <p>
              OffRec est une plateforme d'intermédiation pour l'emploi, les missions professionnelles et la recommandation de talents qualifiés à Madagascar. Le service propose notamment :
            </p>
            <ul>
              <li>La publication et la consultation d’offres d’emploi et de missions vérifiées.</li>
              <li>La mise en relation qualifiée et le matching entre profils certifiés et besoins de recrutement.</li>
              <li>La planification d’entretiens de recrutement avec génération sécurisée de liens de visioconférence (Google Meet).</li>
              <li>Un annuaire de talents et d’entreprises recommandés par leurs pairs.</li>
            </ul>
          </section>

          <section id="accounts" className="legal-section">
            <h2>3. Inscription et sécurité des comptes</h2>
            <p>
              L’accès à certaines fonctionnalités requiert la création d’un compte personnel. L’utilisateur s'engage à fournir des informations véridiques, exactes et à jour lors de son inscription.
            </p>
            <p>
              L’identifiant et le mot de passe sont strictement personnels et confidentiels. L’utilisateur est seul responsable de toute activité réalisée depuis son compte. En cas d’accès non autorisé ou de suspicion de compromission, il doit en avertir sans délai l’équipe OffRec.
            </p>
          </section>

          <section id="rules-candidates" className="legal-section">
            <h2>4. Engagements des candidats et talents</h2>
            <p>Tout candidat ou talent inscrit sur la plateforme s’engage à :</p>
            <ul>
              <li>Fournir des informations de curriculum vitæ (CV), diplômes, compétences et références professionnelles sincères et conformes à la réalité.</li>
              <li>Répondre loyalement aux propositions de mise en relation et honorer les créneaux d’entretien convenus.</li>
              <li>Signaler dans les meilleurs délais tout empêchement via l'interface dédiée afin de permettre la reprogrammation ou l'annulation respectueuse de l'entretien.</li>
            </ul>
          </section>

          <section id="rules-recruiters" className="legal-section">
            <h2>5. Engagements des entreprises et recruteurs</h2>
            <p>Tout employeur ou recruteur déposant des offres d’emploi ou sollicitant des candidats s’engage à :</p>
            <ul>
              <li>Publier des offres d’emploi réelles, licites et correspondant à des postes effectivement ouverts.</li>
              <li>Respecter scrupuleusement la réglementation du travail en vigueur et proscrire toute discrimination à l'embauche.</li>
              <li>Traiter avec respect et diligence les dossiers des candidats transmis par OffRec.</li>
              <li>Renseigner l'issue des entretiens et des processus d'embauche dans un délai raisonnable.</li>
            </ul>
          </section>

          <section id="interviews" className="legal-section">
            <h2>6. Organisation des entretiens et visioconférences</h2>
            <p>
              OffRec facilite l'organisation technique des entretiens en s'interfaçant avec l'agenda Google d'OffRec pour générer des liens de visioconférence Google Meet.
            </p>
            <p>
              Afin de protéger la vie privée des deux parties, les données de contact direct (adresses email personnelles) ne sont pas exposées dans l'agenda tiers. Chaque participant reçoit son lien de connexion via son espace OffRec sécurisé.
            </p>
          </section>

          <section id="ip" className="legal-section">
            <h2>7. Propriété intellectuelle</h2>
            <p>
              L’ensemble des marques, textes, chartes graphiques, logos, architectures et codes sources composant la plateforme OffRec sont la propriété exclusive de Qualitec Madagascar et de ses concédants, et sont protégés par le droit de la propriété intellectuelle.
            </p>
          </section>

          <section id="liability" className="legal-section">
            <h2>8. Responsabilité et disponibilité</h2>
            <p>
              OffRec met en œuvre des moyens raisonnables pour assurer la disponibilité continue de son service (24h/24, 7j/7). Toutefois, OffRec ne saurait être tenue pour responsable d’interruptions momentanées liées à la maintenance, aux pannes de réseaux de télécommunication ou à des défaillances de services tiers (notamment les services Google Meet ou Calendar).
            </p>
            <p>
              OffRec agit en qualité d’intermédiaire de mise en relation et ne garantit pas la conclusion d’un contrat de travail ou de prestation entre les parties.
            </p>
          </section>

          <section id="law" className="legal-section">
            <h2>9. Droit applicable et juridiction compétente</h2>
            <p>
              Les présentes CGU sont régies et interprétées conformément au droit de la République de Madagascar. Tout litige relatif à leur validité, leur interprétation ou leur exécution sera soumis, à défaut de résolution amiable, aux tribunaux compétents d'Antananarivo.
            </p>
            <div className="legal-contact-box">
              <p><strong>OffRec — Support juridique et administratif</strong></p>
              <p>Email : <a href="mailto:contact@qualitec.mg">contact@qualitec.mg</a></p>
              <p>Antananarivo, Madagascar</p>
            </div>
            <p style={{ marginTop: '1.5rem' }}>
              <Link to="/">← Retour à l’accueil OffRec</Link> · <Link to="/politique-de-confidentialite">Consulter la Politique de confidentialité</Link>
            </p>
          </section>
        </article>
      </div>
    </div>
  )
}
