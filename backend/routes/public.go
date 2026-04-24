package routes

import "github.com/gofiber/fiber/v3"

func RegisterPublicRoutes(app *fiber.App) {
	app.Get("/", func(c fiber.Ctx) error {
		return c.SendString("Hello, Sangria!")
	})

	app.Get("/health", func(c fiber.Ctx) error {
		return c.SendStatus(200)
	})
}
