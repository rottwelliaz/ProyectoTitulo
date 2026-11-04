import Joi from 'joi';

const nombreServicioRegex = /^[\p{L}\s+\-/.&]+$/u;
const descripcionRegex = /^[\p{L}0-9\s]+$/u;

const nombreServicio = Joi.string()
  .trim()
  .max(80)
  .pattern(nombreServicioRegex)
  .messages({
    'string.base': 'El nombre del servicio debe ser texto',
    'string.empty': 'El nombre del servicio es obligatorio',
    'string.pattern.base': 'El nombre del servicio solo puede contener letras y símbolos permitidos, sin números',
  });

const descripcion = Joi.string()
  .trim()
  .max(300)
  .pattern(descripcionRegex)
  .allow(null, '')
  .messages({
    'string.base': 'La descripción debe ser texto',
    'string.pattern.base': 'La descripción solo puede contener letras y números',
  });

const precio = Joi.number()
  .integer()
  .min(1000)
  .max(50000)
  .messages({
    'number.base': 'El precio debe ser un número',
    'number.integer': 'El precio debe ser un número entero',
    'number.min': 'El precio debe empezar desde 1000',
    'number.max': 'El precio no puede ser mayor a 50000',
  });

export const createServiceValidation = Joi.object({
  nombre_servicio: nombreServicio.required().messages({
    'any.required': 'El nombre del servicio es obligatorio',
  }),
  descripcion: descripcion.optional(),
  precio: precio.required().messages({
    'any.required': 'El precio es obligatorio',
  }),
}).unknown(false).messages({
  'object.unknown': 'No se permiten campos adicionales en la creación de servicio',
});

export const updateServiceValidation = Joi.object({
  activo: Joi.boolean().strict().optional(),
  nombre_servicio: nombreServicio.optional(),
  descripcion: descripcion.optional(),
  precio: precio.optional(),
}).unknown(false).messages({
  'object.unknown': 'No se permiten campos adicionales en la edición de servicio',
});
