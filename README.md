# Blockfacho — Firefox

Adaptation Firefox de l’extension fournie.

## Test temporaire

1. Ouvrir `about:debugging#/runtime/this-firefox`.
2. Cliquer sur « Charger un module complémentaire temporaire ».
3. Choisir le fichier `manifest.json` dans le dossier décompressé (ou le ZIP si proposé).
4. Se connecter à X dans Firefox, puis cliquer sur l’extension.
5. Tester d’abord en mode « À blanc ».

Une extension temporaire disparaît au redémarrage de Firefox. Pour une installation permanente sur Firefox standard, une signature Mozilla est normalement nécessaire. Soumettre le ZIP sur addons.mozilla.org pour signature / publication.

## Modifications

- Identifiant Gecko ajouté au manifeste Manifest V3.
- Permission d’accès à `blockfacho.pages.dev` ajoutée en plus du domaine d’origine.
- Remplacement de `Object.groupBy` pour la compatibilité.

Attention : l’interface X peut changer ; les sélecteurs de blocage ne sont pas garantis. Le fonctionnement réel n’a pas été testé dans Firefox.

## v1.0.6
- Vérification répétée (jusqu'à quatre rechargements) après un clic de blocage, sans recliquer.
- Si X ne confirme pas, statut « confirmation différée » et non faux échec ; le compte n'est pas marqué comme bloqué.
- Onglet de travail créé explicitement dans la fenêtre Firefox pour éviter de réutiliser l'ID de l'onglet initial.
- Tester d'abord en mode À blanc. Les changements n'ont pas été testés dans un navigateur réel.
# blockfacho_firefox
