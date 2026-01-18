
# use ollama library to interact with local LLM models
from httpx import post
from ollama import chat
from ollama import ChatResponse

MODEL_NAME = "gemma3:27b"


class Prompt_abstraction:
	def __init__(self, post: str, original_post: str, context: str):
		self.post = post
		self.original_post = original_post
		self.context = context
	
	def post_or_response(self) -> str:
		if self.original_post :
			return "\n\nCe post est une réponse au message suivant :\n" + f" \"\"\"{self.original_post}\"\"\"\n\n"
		else:
			return ""

	def generate_prompt(self) -> str:
		return """Tu es un analyste linguistique.

À partir du post ci-dessous, extrais les éléments suivants SANS reformuler le texte original, évite également de citer ou paraphraser des parties spécifiques, l'objectif sera à un autre modèle de générer un nouveau message humain similaire en se basant uniquement sur ces éléments abstraits.

1. Objectif principal du message (1 phrase)
2. Points clés exprimés (liste de 3 à 6 idées)
3. Ton général (ex: neutre, enthousiaste, frustré)
4. Registre de langue (familier, courant, soutenu)
5. Contexte implicite (plateforme, situation, public visé)
6. Contraintes stylistiques importantes (longueur approximative, structure, présence d'exemples personnels)

Post :\n\n\"\"\"""" + self.post + "\"\"\"\n\nContexte additionnel:\n" + self.post_or_response() + "\n" + self.context

class Prompt_regeneration:
	def __init__(self, original_post: str, platform: str, abstracted_info: str): 
		self.original_post = original_post
		self.platform = platform
		self.abstracted_info = abstracted_info
	
	def post_or_response(self) -> str:
		if self.original_post :
			return "\n\nPost auquel tu dois répondre :" + f" \"\"\"{self.original_post}\"\"\"\n\n"
		else:
			return ""
	
	def generate_prompt(self) -> str:
		return "Tu es un utilisateur humain écrivant un message sur" + f" {self.platform}.\n" + """À partir des informations ci-dessous, rédige un nouveau message original en français.

Contraintes STRICTES :
- Le message doit sembler écrit par un humain, pas par une IA
- Respecter le ton et le registre indiqués
- Suivre les points clés et l'objectif principal
- Prendre en compte le contexte implicite
- Autoriser de légères hésitations ou imprécisions en fonction de la description donnée
- Longueur similaire à l'original

Informations sur le message à rédiger :
""" + self.abstracted_info + "\n\n" + """
IMPORTANT :
- Ne PAS chercher à améliorer le style
- Ne PAS conclure de manière trop nette
- Ne PAS utiliser de phrases "parfaites"
		""" + self.post_or_response()

def call_ollama_model(prompt: str) -> str:
	response: ChatResponse = chat(model=MODEL_NAME, messages=[
		{
			"role": "user",
			"content": prompt
		},
	])
	return response['message']['content']

test_post_1 = """
Le vraie richesse, c'est pas l'argent.

La vraie richesse, c'est d'avoir sa grand-mère de 94 ans au téléphone qui te dit : "il y a un film sur le hérisson bleu que je t'avais offert pour ta SEGA quand tu étais petit. J'peux pas venir avec toi mais il faut que tu ailles le voir"
"""
test_context_1 = "Le post est destiné à un public francophone sur Twitter."
test_platform_1 = "Twitter"


test_post_2 = """
Honnêtement, exister c'est le seul non sens qu'il y ait. Je ne pense pas que l'on représente quoi que soit d'autre, de manière globale. Je ne pense pas non plus que la vie ait un sens, réellement.

Ensuite, de par notre évolution humaine et cérébrale, je dirais que le plus important sens que l'on peut donner à notre éphémère existence est d'être heureux. Aussi niais que cela puisse paraître, il ne me semble pas y avoir quoi que ce soit de plus important. Mais au final on est un grain de sable perdu dans l'immensité du temps et de l'espace alors osef.
"""
test_original_post_2 = """
Pour vous, quel serait le sens de la vie ?
"""
test_platform_2 = "Reddit"
test_context_2 = "Le post est une réponse à une question posée sur le subreddit r/philosophy."


test_post_3 = """
J’ai un Monsieur Cuisine de LIDL (version du milieu, ni la toute vieille ni la connectée), que j’ai acheté d’occasion pour 150€. Le type qui me l’a vendu s’en était très peu servi donc il était quasi neuf et je l’utilise quand même pas mal. Un peu moins depuis que j’ai arrêté la viande mais pour les soupes, ragoûts, sauces, crèmes et pâtes, ça me fait gagner un temps fou. Je l’ai depuis presque deux ans et demi et il fonctionne toujours super bien. """
test_original_post_3 = """
TITRE : Avis pour robot cuiseur

Bonjour AirFrance! J'immisce mon post à travers tout ceux de r/place.

Je recherche un robot cuiseur. Celui de LIDL me fait un peu peur vu toutes les mauvaises surprises que j'ai eu avec silvercrest.

Mes parents ont un Thermomix que j'ai utilisé à plusieurs reprises, j'ai mon avis dessus maintenant. Mais c'est pas donné! A la limite si un paiement en 10 fois existait je dirais pas non, mais là..

C'est pour ça que je me tourne vers vous. Est-ce que vous avez ce genre d'appareil chez vous, et si oui pouvez vous me faire un retour svp? Merci!
"""
test_platform_3 = "Reddit"
test_context_3 = "Le post est une réponse à une demande d'avis sur le subreddit r/france."

test_post_4 = """
TITRE : Est-ce que vous avez une déformation professionnelle?

Pour moi personnellement non, mais j'ai rencontré plusieurs personnes qui ont tendance à reproduire inconsciemment ce qu'elles font au travail. Notamment celles qui travaillent dans la santé.

J'ai plusieurs amies infirmières qui repèrent les veines qu'elles pourraient utiliser pour faire des prises de sang, transfusions et j'en passe, sur les gens qui les entourent ou même des inconnus, alors qu'elles sont au bar ou au restaurant

Et vous?
"""
test_platform_4 = "Reddit"
test_context_4 = "Le post est destiné à un public francophone sur le subreddit r/france."


test_post_5 = """
La couture ! Très facile, accessible sans gros investissement (machine neuve en entrée de gamme est autour de 100€, tu trouve de bonnes occasions pour une cinquantaine d'euros en mécanique) extrêmement addictif, et si tu te débrouilles bien c'est vendable :) Pour le tissus, afin de ne pas te ruiner il y a des tonnes de possibilités en seconde main (Emmaüs, puces de couturière,...). Sur un volet moins écolo il y a des sites avec des tissus a environ 1€/m (avec des laize de 1.3m) 
"""
test_original_post_5 = """
TITRE : Suggestions de hobby ?

Bonjour les airfrançais!

Je voulais savoir ce que vous me suggéreriez comme passe-temps à découvrir / dans lequel investir du temps dans ma situation.

J'habite dans un appartement en ville moyenne, donc pas énormément de place à consacrer à ce nouveau hobby. J'aimerais pouvoir découvrir l'activité sans avoir besoin d'y investir trop d'argent, et dans l'idéal j'aimerais quelque chose qui ne coûte pas trop (ou, mieux, qui produise quelque chose qui à terme trouve acheteur. La consommation passive commence sérieusement à me gonfler). Mes passe-temps actuels sont les jeux vidéo et les legos, mais les jeux vidéo, en solo, commencent à ressembler trop à cette consommation passive dont je parlais, et les legos ont une certaine tendenace à prendre de la place... et à faire des trous dans le porte-monnaie.

Alors j'en appelle à la sagesse de reddit. Quel passe-temps me conseillez-vous? Laquelle de vos passions voulez-vous me faire partager?

Edition : merci pour les idees tout le monde! Je vais me coucher, je coupe les notifications.
"""
test_platform_5 = "Reddit"
test_context_5 = "Le post est une réponse à une demande de suggestions de passe-temps sur le subreddit r/france."


test_post_6 = """ TITRE : Qu'est-ce qui rend votre métier indispensable ?

Je me suis dis que cela pourrait être intéressant Pour ma part je suis agriculteur donc sans mon métier personne ne mange, pour être précis je suis chevrier avec des chèvres en pâture donc adieu les petits fromages de chèvres et fini les ballades puisque que sans leur action le territoire s'ensauvagerait et il faudrait y aller avec une machette.
"""
test_platform_6 = "Reddit"
test_context_6 = "Le post est destiné à un public francophone sur le subreddit r/france."


test_post_7 = """ Contacter la police/gendarmerie du coin avec le plus d'information sur :

- les preuves de l'achat de ton amis qui a disparu lors de la livraison (si possible des preuves de la disparition du colis);

- le profil du vendeur et ses produits en vente ;

Ce genre d'information peut être utile à la police/gendarmerie pour attraper les livreur qui font du vol et recel en masse.

Il ne récupérera peut être pas son achat mais au moins le receleur se ferra peut être chopper.
"""

test_original_post_7 =""" TITRE :matériel informatique volé ?
Société

pour faire court, j'ai un ami qui a vu son Steam Deck 512GB "perdu" pendant la livraison hier.

on a trouvé un listing ebay...

- mis en ligne aujourd'hui
- dans la ville d'a coté (Bourgoin-Jallieu)
- neuf, boitier de transport encore sous scellé
- mais sans le carton de transport (ou est l'étiquette avec le nom du destinataire)
- sur un profil qui a un bon air de receleur (2 steamdecks 64GB deja vendus par exemple, des switchs jailbroken, etc)

est-ce qu'il y a quelque chose à faire, une unité de la police spécifique qu'on pourrait contacter ?

GLS s'en contretape, Valve va gérer son ticket comme ils veulent (soit remboursement et livraison 2023 lol, soit en renvoyer un), mais c'est quelque peu irritant que les voleurs s'en tirent sans aucune conséquence chez nous...
"""
test_platform_7 = "Reddit"
test_context_7 = "Le post est une réponse à une demande d'aide sur le subreddit r/france."


test_post_8 = """ 
Ha oui grosse mesure en effet... C'est sûr que ça va calmer les mecs qui roulent a 70km/h(voir parfois plus...), grillent les feux rouges, roulent parfois sans feux... Le problème c'est pas ceux qui roulent a 50. C'est ceux qui conduisent n'importe comment au mepris de toute regles de sécu. J'ai meme vu quelqu'un qui regardait sa petite video youtube tout en roulant... 
"""
test_original_post_8 =""" TITRE : Le 30 mars 2022, la Ville de Lyon passe à 30km/h! Lyon fait le choix de ralentir la vitesse, pour mieux accélérer le bien-être de ses habitants. Notre objectif : limiter le nombre d'accidents graves sur la route. Partout où elle a été mise en place, la baisse de la vitesse a réduit l'accidentologie 
contenu : lien vers https://threadreaderapp.com/thread/1504736073368358914.html
"""
test_platform_8 = "Reddit"
test_context_8 = "Le post est une réponse à une annonce sur le subreddit r/Lyon."

def autre_appel():
	prompt = """
	Répond au post reddit suivant (subreddit r/france) de manière naturelle et humaine, en français, essaye de faire une réponse qui pourrait être écrite par un utilisateur lambda, il faudrait une réponse humoristique et légère.
	
TITRE : j'ai trouvé du Roquefort Société aux USA, et il y a un avertissement sur la boite...

J'y suis avec ma femme pour voir ses parents, et on a trouvé du Roquefort Société dans un équivalent Grand Frais qui apparemment est importé de chez nous et porte cet avertissement :

    It is not recommended for fragile people, including young people, to consume it.

https://i.vgy.me/kEjKWS.jpg

je suppose que ca a quelque chose a voir avec le lait non pasteurisé, mais vu que si on laisse ma nièce seule avec du roquefort depuis ses 2 ans la boite se vide mystérieusement ca me fait un peu ricaner.

on leur a aussi amené de la moutarde de Dijon Maille, qui est aussi vendue ici en supermarché et du coup on a pu faire une comparaison :

https://i.vgy.me/Bvu8Hg.jpg

la version française a tellement plus de goût et de piquant que je suis limite révolté que l'autre puisse être vendue sous le même nom.

sa famille a aussi rigolé quand j'ai prononcé "charcuterie" correctement. ils ont aimé le roquefort ceci dit, qui a au moins le meme gout qu'en France :D
"""
	response: ChatResponse = chat(model=MODEL_NAME, messages=[
		{
			"role": "user",
			"content": prompt
		},
	])
	print(response['message']['content'])
	exit()


if __name__ == "__main__":

	# autre_appel()

	poste = test_post_8
	contexte = test_context_8
	original_poste = test_original_post_8
	plateforme = test_platform_8

	# Step 1: Abstract the original post
	prompt_abstractor = Prompt_abstraction(post=poste, context=contexte, original_post=original_poste)
	abstract_prompt = prompt_abstractor.generate_prompt()
	print("================================================")
	print("Abstract Prompt:\n", abstract_prompt)
	abstracted_info = call_ollama_model(abstract_prompt)
	print("================================================")
	print("Abstracted Information:\n", abstracted_info)
	print("================================================")

	# Step 2: Regenerate a new post based on the abstracted information
	prompt_regenerator = Prompt_regeneration(original_post=original_poste, platform=plateforme, abstracted_info=abstracted_info)
	regenerate_prompt = prompt_regenerator.generate_prompt()
	print("================================================")
	print("\nRegenerate Prompt:\n", regenerate_prompt)
	new_post = call_ollama_model(regenerate_prompt)
	print("================================================")
	print("\nRegenerated Post:\n", new_post)
	print("================================================")




