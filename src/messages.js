// -----------------------------------------------------------------------------
// Texts the runtime sends to Gladys: connection statuses, action results,
// command refusals. Multi-language objects: the core and the browser pick the
// user's language. Kept short: an action toast is cut at 200 characters.
// -----------------------------------------------------------------------------

import { ERROR_KINDS } from './renault/errors.js';

export const MESSAGES = {
  notConfigured: {
    en: 'Enter the e-mail address and password of your MY Renault or MY Dacia account.',
    fr: 'Saisissez l’adresse e-mail et le mot de passe de votre compte MY Renault ou MY Dacia.',
    de: 'Gib die E-Mail-Adresse und das Passwort deines MY-Renault- oder MY-Dacia-Kontos ein.',
    es: 'Introduzca el correo electrónico y la contraseña de su cuenta MY Renault o MY Dacia.',
  },
  [ERROR_KINDS.AUTH]: {
    en: 'The account refused the sign-in: check the country, e-mail address and password, then save.',
    fr: 'Le compte a refusé la connexion : vérifiez le pays, l’adresse e-mail et le mot de passe, puis enregistrez.',
    de: 'Das Konto hat die Anmeldung abgelehnt: Prüfe Land, E-Mail-Adresse und Passwort und speichere dann.',
    es: 'La cuenta ha rechazado el inicio de sesión: revise el país, el correo y la contraseña, y guarde.',
  },
  [ERROR_KINDS.TFA_REQUIRED]: {
    en: 'Your account asks for a code sent by e-mail: click “Send the verification code”, then “Enter the code”.',
    fr: 'Votre compte demande un code envoyé par e-mail : cliquez sur « Envoyer le code de vérification », puis « Saisir le code ».',
    de: 'Dein Konto verlangt einen per E-Mail gesendeten Code: Klicke auf „Bestätigungscode senden“, dann auf „Code eingeben“.',
    es: 'Su cuenta pide un código enviado por correo: pulse «Enviar el código de verificación» y luego «Introducir el código».',
  },
  [ERROR_KINDS.BLOCKED]: {
    en: 'The sign-in service refuses the connection for now (too many attempts). Wait a few hours, then save again.',
    fr: 'Le service de connexion refuse pour le moment (trop de tentatives). Patientez quelques heures, puis enregistrez à nouveau.',
    de: 'Der Anmeldedienst lehnt die Verbindung gerade ab (zu viele Versuche). Warte einige Stunden und speichere dann erneut.',
    es: 'El servicio de inicio de sesión rechaza la conexión por ahora (demasiados intentos). Espere unas horas y guarde de nuevo.',
  },
  [ERROR_KINDS.RATE_LIMIT]: {
    en: 'The request quota of the Renault cloud is spent: reads resume in 15 minutes.',
    fr: 'Le quota de requêtes du cloud Renault est épuisé : les relevés reprennent dans 15 minutes.',
    de: 'Das Anfragekontingent der Renault-Cloud ist aufgebraucht: Die Abfragen laufen in 15 Minuten weiter.',
    es: 'Se ha agotado la cuota de solicitudes de la nube de Renault: las lecturas se reanudan en 15 minutos.',
  },
  [ERROR_KINDS.PRIVACY]: {
    en: 'The privacy mode of the car is on: it shares nothing and accepts no remote command.',
    fr: 'Le mode confidentialité de la voiture est activé : elle ne partage rien et refuse les commandes à distance.',
    de: 'Der Privatsphäre-Modus des Autos ist an: Es teilt nichts und nimmt keine Fernbefehle an.',
    es: 'El modo de privacidad del coche está activado: no comparte nada y no acepta comandos remotos.',
  },
  [ERROR_KINDS.NOT_SUPPORTED]: {
    en: 'This car does not offer this command remotely.',
    fr: 'Cette voiture ne propose pas cette commande à distance.',
    de: 'Dieses Auto bietet diesen Befehl nicht aus der Ferne an.',
    es: 'Este coche no ofrece este comando a distancia.',
  },
  [ERROR_KINDS.ACCESS_DENIED]: {
    en: 'The Renault cloud refused this command for this car (model or subscription).',
    fr: 'Le cloud Renault a refusé cette commande pour cette voiture (modèle ou abonnement).',
    de: 'Die Renault-Cloud hat diesen Befehl für dieses Auto abgelehnt (Modell oder Abo).',
    es: 'La nube de Renault ha rechazado este comando para este coche (modelo o suscripción).',
  },
  [ERROR_KINDS.IN_PROGRESS]: {
    en: 'A change of the same kind is already in progress on this car: try again in a few minutes.',
    fr: 'Un changement du même type est déjà en cours sur cette voiture : réessayez dans quelques minutes.',
    de: 'Eine gleichartige Änderung läuft schon auf diesem Auto: Versuche es in ein paar Minuten erneut.',
    es: 'Ya hay un cambio del mismo tipo en curso en este coche: vuelva a intentarlo en unos minutos.',
  },
  chargeStopUnsupported: {
    en: 'This model cannot stop a charge remotely: stop it from the charger or the car.',
    fr: 'Ce modèle ne peut pas arrêter une charge à distance : arrêtez-la depuis la borne ou la voiture.',
    de: 'Dieses Modell kann das Laden nicht aus der Ferne stoppen: Stoppe es an der Ladestation oder im Auto.',
    es: 'Este modelo no puede detener una carga a distancia: deténgala desde el cargador o el coche.',
  },
  unreachable: {
    en: 'The Renault cloud is unreachable for now, retrying.',
    fr: 'Le cloud Renault est injoignable pour le moment, nouvel essai en cours.',
    de: 'Die Renault-Cloud ist gerade nicht erreichbar, neuer Versuch läuft.',
    es: 'La nube de Renault no está disponible por ahora, nuevo intento en curso.',
  },
  accountNotFound: {
    en: 'No vehicle found in the account entered in “Account”: empty the field to use every account.',
    fr: 'Aucun véhicule trouvé dans le compte saisi dans « Compte » : videz le champ pour utiliser tous les comptes.',
    de: 'Im unter „Konto“ eingegebenen Konto wurde kein Fahrzeug gefunden: Leere das Feld, um alle Konten zu nutzen.',
    es: 'No se ha encontrado ningún vehículo en la cuenta indicada en «Cuenta»: vacíe el campo para usar todas.',
  },
  commandSent: {
    en: 'Request accepted by the Renault cloud. The car carries it out on its own: its next update will tell.',
    fr: 'Demande acceptée par le cloud Renault. La voiture l’exécute de son côté : sa prochaine mise à jour le dira.',
    de: 'Anfrage von der Renault-Cloud angenommen. Das Auto führt sie selbst aus: Die nächste Aktualisierung zeigt es.',
    es: 'Solicitud aceptada por la nube de Renault. El coche la ejecuta por su cuenta: su próxima actualización lo dirá.',
  },
  refreshed: {
    en: 'State read again from the Renault cloud (the car itself is not woken).',
    fr: 'État relu depuis le cloud Renault (la voiture elle-même n’est pas réveillée).',
    de: 'Zustand erneut aus der Renault-Cloud gelesen (das Auto selbst wird nicht geweckt).',
    es: 'Estado leído de nuevo desde la nube de Renault (el coche en sí no se despierta).',
  },
  setpointSaved: {
    en: 'Temperature saved: it is sent with the next preconditioning.',
    fr: 'Température enregistrée : elle sera envoyée avec le prochain préconditionnement.',
    de: 'Temperatur gespeichert: Sie wird mit der nächsten Vorklimatisierung gesendet.',
    es: 'Temperatura guardada: se enviará con el próximo preacondicionamiento.',
  },
  notSaved: {
    en: 'No account is saved yet: enter the e-mail address and password, save, then try again.',
    fr: 'Aucun compte n’est encore enregistré : saisissez l’adresse e-mail et le mot de passe, enregistrez, puis réessayez.',
    de: 'Noch kein Konto gespeichert: Gib E-Mail-Adresse und Passwort ein, speichere und versuche es dann erneut.',
    es: 'Todavía no hay ninguna cuenta guardada: introduzca el correo y la contraseña, guarde y vuelva a intentarlo.',
  },
  starting: {
    en: 'The integration is starting: try again in a few seconds.',
    fr: 'L’intégration démarre : réessayez dans quelques secondes.',
    de: 'Die Integration startet: Versuche es in ein paar Sekunden erneut.',
    es: 'La integración se está iniciando: vuelva a intentarlo dentro de unos segundos.',
  },
  initFailed: {
    en: 'Initialization failed, check the integration logs.',
    fr: 'L’initialisation a échoué, consultez les journaux de l’intégration.',
    de: 'Initialisierung fehlgeschlagen, sieh in den Logs der Integration nach.',
    es: 'La inicialización ha fallado, consulte los registros de la integración.',
  },
  unknownVehicle: {
    en: 'Choose a Renault or Dacia vehicle of this integration.',
    fr: 'Choisissez un véhicule Renault ou Dacia de cette intégration.',
    de: 'Wähle ein Renault- oder Dacia-Fahrzeug dieser Integration.',
    es: 'Elija un vehículo Renault o Dacia de esta integración.',
  },
  tfaNotNeeded: {
    en: 'No code needed: the account signed in directly.',
    fr: 'Aucun code nécessaire : le compte s’est connecté directement.',
    de: 'Kein Code nötig: Das Konto hat sich direkt angemeldet.',
    es: 'No hace falta ningún código: la cuenta ha iniciado sesión directamente.',
  },
  tfaSendFirst: {
    en: 'No code is waiting: click “Send the verification code” first.',
    fr: 'Aucun code n’est en attente : cliquez d’abord sur « Envoyer le code de vérification ».',
    de: 'Es wartet kein Code: Klicke zuerst auf „Bestätigungscode senden“.',
    es: 'No hay ningún código pendiente: pulse primero «Enviar el código de verificación».',
  },
  tfaWrongCode: {
    en: 'This code is wrong: check the last e-mail received and enter its code again.',
    fr: 'Ce code est faux : vérifiez le dernier e-mail reçu et saisissez à nouveau son code.',
    de: 'Dieser Code ist falsch: Prüfe die zuletzt erhaltene E-Mail und gib ihren Code erneut ein.',
    es: 'Este código es incorrecto: revise el último correo recibido e introduzca de nuevo su código.',
  },
  tfaCodeFormat: {
    en: 'Enter the code of the e-mail, digits only.',
    fr: 'Saisissez le code de l’e-mail, chiffres seulement.',
    de: 'Gib den Code aus der E-Mail ein, nur Ziffern.',
    es: 'Introduzca el código del correo, solo cifras.',
  },
};

// Status rows of the widget, 40 characters at most.
export const WIDGET_ISSUES = {
  [ERROR_KINDS.AUTH]: {
    en: 'Sign-in refused (configuration)',
    fr: 'Connexion refusée (configuration)',
    de: 'Anmeldung abgelehnt (Konfiguration)',
    es: 'Inicio de sesión rechazado',
  },
  [ERROR_KINDS.TFA_REQUIRED]: {
    en: 'E-mailed code needed (configuration)',
    fr: 'Code par e-mail requis (configuration)',
    de: 'E-Mail-Code nötig (Konfiguration)',
    es: 'Código por correo necesario',
  },
  [ERROR_KINDS.BLOCKED]: {
    en: 'Sign-in refused for now',
    fr: 'Connexion refusée pour le moment',
    de: 'Anmeldung gerade abgelehnt',
    es: 'Inicio de sesión rechazado por ahora',
  },
};

/** An Error carrying a multi-language text, for action and widget toasts. */
export class UserError extends Error {
  constructor(text, kind) {
    super(text.en);
    this.text = text;
    if (kind) this.kind = kind;
  }
}

/**
 * A failed manifest action. Thrown, so Gladys shows it in red: the core relays
 * the thrown `message` untouched to the browser, which picks the user's
 * language in a `{ en, fr, de, es }` object. A resolved action is always shown
 * as a success: there is no warning level.
 */
export class ActionFailure extends Error {
  constructor(text) {
    super(text.en);
    this.message = text;
    this.text = text;
  }
}

/** The multi-language text of a cloud failure, `null` when none fits. */
export function userTextOf(err) {
  if (err instanceof UserError || err instanceof ActionFailure) return err.text;
  if (MESSAGES[err?.kind]) return MESSAGES[err.kind];
  if (err?.kind === ERROR_KINDS.NETWORK || err?.kind === ERROR_KINDS.SERVER) {
    return MESSAGES.unreachable;
  }
  if (err?.kind === ERROR_KINDS.TFA_CODE) return MESSAGES.tfaWrongCode;
  return null;
}

/** A text for any failure: the known one, else the cloud's own words. */
export function failureText(err) {
  const known = userTextOf(err);
  if (known) return known;
  const detail = String(err?.message ?? err).slice(0, 120);
  return {
    en: `The Renault cloud refused the request: ${detail}`,
    fr: `Le cloud Renault a refusé la requête : ${detail}`,
    de: `Die Renault-Cloud hat die Anfrage abgelehnt: ${detail}`,
    es: `La nube de Renault ha rechazado la solicitud: ${detail}`,
  };
}
