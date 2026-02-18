# Analyse critique de skills-mcp

## Ce que ça résout réellement

**Le problème de fond est réel.** Les assistants IA génèrent du code "générique" qui ignore les conventions d'équipe. Les `CLAUDE.md` fonctionnent mais sont des blobs monolithiques chargés en permanence. Il y a un vrai gap entre "l'IA sait coder" et "l'IA code comme nous".

**L'économie de contexte est l'argument le plus solide.** Un `CLAUDE.md` de 2000 lignes couvrant React, API, testing, infra est chargé en entier même quand Claude fait un simple composant bouton. skills-mcp ne sert que le skill pertinent + ses ancêtres. Sur des équipes avec beaucoup de conventions, la différence de consommation de tokens est concrète et mesurable.

**L'héritage hiérarchique est une vraie bonne idée.** Factoriser les règles globales dans `_root.md`, les règles UI dans `ui/_index.md`, les règles React dans `ui/react/_index.md` et les règles auth dans `ui/react/auth.md` est élégant. C'est du DRY appliqué aux instructions IA. Modifier une convention globale à un seul endroit au lieu de 15 fichiers est un gain de maintenance réel.

**Les assets associés comblent un manque.** Pouvoir servir un template `.tsx` ou un schéma JSON à côté des instructions textuelles va au-delà de ce que permettent les fichiers de règles statiques. L'IA reçoit à la fois "comment faire" et "à partir de quoi".

---

## Là où la valeur est plus nuancée

**Le routing par keywords est à double tranchant.** C'est présenté comme un avantage (déterministe, débogable) par opposition aux descriptions vagues des skills Claude natifs. C'est vrai. Mais c'est aussi rigide : il faut anticiper les termes que l'IA va utiliser. Si Claude dit "login form" et que les keywords sont `[auth, authentication, provider, guard]`, le match peut échouer. Le matching bidirectionnel (substring) atténue le problème mais ne l'élimine pas. En pratique, le maintien de bonnes listes de keywords demande un effort itératif non négligeable.

**La centralisation Git est un avantage ET une contrainte.** Pour une équipe de 5-15 devs avec des conventions stables, c'est idéal. Pour un développeur solo, le overhead (repo séparé, sync Git, serveur MCP) est disproportionné par rapport à un `CLAUDE.md` bien structuré. Le sweet spot est clairement l'équipe moyenne à grande.

**L'observabilité (analytics + feedback) est prometteuse mais conditionnelle.** Le système track les `no_match`, les ambiguïtés, les feedbacks négatifs. C'est le bon design. Mais la valeur n'existe que si quelqu'un exploite ces données. Sans process de review des analytics, c'est du logging mort. Et le `report_usage` dépend du fait que l'IA pense à l'appeler, ce qui n'est pas garanti sans instruction explicite.

**"Réutilisation cross-outil" est un argument faible.** Oui, les skills sont du Markdown. Mais en pratique, le frontmatter YAML (keywords, inherit, priority, assets) est spécifique à skills-mcp. Réutiliser le contenu brut pour de la documentation ou de l'onboarding demande de l'ignorer ou de le stripper. Ce n'est pas faux, mais c'est marginal comme avantage.

---

## Limites et risques honnêtes

**Coût d'adoption non trivial.** Il faut : installer le serveur, créer un repo de skills, écrire les skills avec le bon format, choisir les bons keywords, comprendre l'héritage, configurer le `.mcp.json`. Comparé à "écrire un `CLAUDE.md`", la barrière d'entrée est significativement plus haute. Le ROI ne devient positif qu'avec un volume suffisant de conventions à transmettre.

**Fragilité du keyword matching face au langage naturel.** L'algorithme score `matchedKeywords / totalKeywords`. Un skill avec 8 keywords dont 2 matchent score 0.25. Un skill avec 3 keywords dont 2 matchent score 0.67. Le nombre de keywords influence le score autant que la pertinence. Cela crée un biais structurel : les skills très spécifiques (peu de keywords) scorent plus facilement haut que les skills larges. C'est un compromis conscient, mais qui demande une discipline de rédaction.

**Pas de sémantique, seulement du lexical.** "Créer un formulaire d'inscription" ne matchera pas `[auth, login, authentication]` malgré le lien conceptuel fort. Les skills standards de Claude (basés sur des descriptions en langage naturel traitées par le LLM lui-même) ont ici un avantage réel en compréhension. Le déterminisme de skills-mcp se paie en recall.

**Dépendance au bon vouloir de l'IA d'appeler l'outil.** skills-mcp est un serveur MCP passif. Il faut que Claude Code décide d'appeler `get_skill` au bon moment. Si l'IA juge qu'elle sait déjà faire, elle ne consultera pas les skills. Ce n'est pas un problème de skills-mcp en soi, mais ça limite la garantie que les conventions seront effectivement appliquées, contrairement à un `CLAUDE.md` qui est injecté systématiquement dans le contexte.

**Single point of failure sur la sync Git.** Si le clone initial échoue (token expiré, réseau coupé, repo renommé), le serveur démarre avec zéro skills. Le fallback sur le cache local atténue le problème pour les refreshs, mais pas pour le premier lancement sur une nouvelle machine.

---

## Verdict

skills-mcp est une solution d'ingénierie bien pensée à un problème réel. L'architecture est propre, les choix techniques sont défendables, et le système d'héritage est son meilleur atout.

**La valeur est maximale** pour une équipe de 5+ développeurs avec un volume significatif de conventions (>20 skills), des assets/templates à distribuer, et un process existant de code review sur Git.

**La valeur est faible** pour un développeur solo ou une petite équipe avec peu de conventions : le `CLAUDE.md` reste plus simple, plus fiable (toujours chargé), et suffisant.

**Le risque principal** n'est pas technique mais humain : le système ne produit de la valeur que si les skills sont écrits, maintenus, et que les keywords sont itérés en fonction des analytics. C'est un produit qui demande du jardinage continu, pas un install-and-forget.
