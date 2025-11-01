module.exports = (app) => {
  const blogpost = require('../controllers/blogpost.controller.js')

  var router = require('express').Router()

  // Create a new Tutorial
  router.post('/', blogpost.create)

  // Retrieve all Tutorials
  router.get('/', blogpost.findAll)

  // Retrieve all published Tutorials
  router.get('/published', blogpost.findAllPublished)

  // Retrieve a single Tutorial with id
  router.get('/:id', blogpost.findOne)

  // Update a Tutorial with id
  router.put('/:id', blogpost.update)

  // Delete a Tutorial with id
  router.delete('/:id', blogpost.delete)

  // Create a new Tutorial
  router.delete('/', blogpost.deleteAll)

  router.delete('/soft/:id', blogpost.softDelete)

  app.use('/api/blogposts', router)
}
