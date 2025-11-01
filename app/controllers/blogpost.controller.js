const db = require('../models');
const Blogpost = db.blogposts;
const DeletedBlogposts = db.deletedBlogposts;

/** Create and Save a new Blogpost */
exports.create = async (req, res) => {
  console.log('req',req)
  // console.log()
  try {
    if (!req.body.title) {
      return res.status(400).send({ message: 'Content can not be empty!' })
    }

    // Normaliza os campos de imagem
    const singleUrl =
      typeof req.body.imageUrl === 'string' ? req.body.imageUrl : ''
    const manyUrls = Array.isArray(req.body.imageUrls) ? req.body.imageUrls : []

    const tutorial = new Blogpost({
      title: req.body.title,
      description: req.body.description,
      published: !!req.body.published,
      // compatibilidade com posts antigos:
      imageUrl: singleUrl,
      // nova abordagem (várias imagens):
      imageUrls: manyUrls,
    })

    const data = await tutorial.save()
    return res.send(data)
  } catch (err) {
    console.error('CREATE ERROR:', err)
    return res
      .status(500)
      .send({
        message:
          err.message || 'Some error occurred while creating the Blogpost.',
      })
  }
}

/** Retrieve all Blogposts from the database. (opcional: ordena por mais recentes) */
exports.findAll = async (req, res) => {
  try {
    const title = req.query.title
    const condition = title
      ? { title: { $regex: new RegExp(title), $options: 'i' } }
      : {}

    const data = await Blogpost.find(condition).sort({ createdAt: -1 })
    return res.send(data)
  } catch (err) {
    return res
      .status(500)
      .send({
        message:
          err.message || 'Some error occurred while retrieving blogposts.',
      })
  }
}

/** Find a single Blogpost with an id */
exports.findOne = async (req, res) => {
  try {
    const id = req.params.id
    const data = await Blogpost.findById(id)
    if (!data)
      return res
        .status(404)
        .send({ message: 'Not found Blogpost with id ' + id })
    return res.send(data)
  } catch (err) {
    return res
      .status(500)
      .send({ message: 'Error retrieving Blogpost with id=' + req.params.id })
  }
}

/** Update a Blogpost by id */
exports.update = async (req, res) => {
  try {
    if (!req.body) {
      return res
        .status(400)
        .send({ message: 'Data to update can not be empty!' })
    }

    // Se vier imageUrl/imageUrls, mantém mesma normalização usada no create
    if ('imageUrl' in req.body && typeof req.body.imageUrl !== 'string') {
      req.body.imageUrl = ''
    }
    if ('imageUrls' in req.body && !Array.isArray(req.body.imageUrls)) {
      req.body.imageUrls = []
    }

    const id = req.params.id
    const data = await Blogpost.findByIdAndUpdate(id, req.body, {
      new: true,
      useFindAndModify: false,
    })

    if (!data) {
      return res
        .status(404)
        .send({ message: `Cannot update Blogpost with id=${id}.` })
    }
    return res.send(data)
  } catch (err) {
    return res
      .status(500)
      .send({ message: 'Error updating Blogpost with id=' + req.params.id })
  }
}

/** Delete a Blogpost by id */
exports.delete = async (req, res) => {
  try {
    const id = req.params.id
    const data = await Blogpost.findByIdAndRemove(id, {
      useFindAndModify: false,
    })
    if (!data) {
      return res
        .status(404)
        .send({
          message: `Cannot delete Blogpost with id=${id}. Maybe Blogpost was not found!`,
        })
    }
    return res.send({ message: 'Blogpost was deleted successfully!' })
  } catch (err) {
    return res
      .status(500)
      .send({ message: 'Could not delete Blogpost with id=' + req.params.id })
  }
}

/** Delete all Blogposts */
exports.deleteAll = async (_req, res) => {
  try {
    const data = await Blogpost.deleteMany({})
    return res.send({
      message: `${data.deletedCount} Blogposts were deleted successfully!`,
    })
  } catch (err) {
    return res
      .status(500)
      .send({
        message:
          err.message || 'Some error occurred while removing all blogposts.',
      })
  }
}

exports.softDelete = async (req, res) => {
  try {
    const id = req.params.id

    const tutorial = await Blogpost.findById(id)
    if (!tutorial) {
      return res
        .status(404)
        .send({ message: `Blogpost com id=${id} não encontrado.` })
    }

    // move para collection "deletedBlogposts"
    const deleted = new DeletedBlogposts({
      ...tutorial.toObject(),
      deletedAt: new Date(),
    })
    await deleted.save()

    // remove da coleção principal
    await Blogpost.findByIdAndDelete(id)

    return res.send({
      message: 'Publicação movida para a lixeira com sucesso!',
    })
  } catch (err) {
    console.error(err)
    return res.status(500).send({ message: 'Erro ao mover a publicação.' })
  }
}


/** Find all published Blogposts */
exports.findAllPublished = async (_req, res) => {
  try {
    const data = await Blogpost.find({ published: true }).sort({
      createdAt: -1,
    })
    return res.send(data)
  } catch (err) {
    return res
      .status(500)
      .send({
        message:
          err.message || 'Some error occurred while retrieving blogposts.',
      })
  }
}
