import Joi from 'joi';

const nombreServicioRegex = /^[\p{L}\s+\-/.&]+$/u;
const descripcionRegex = /^[\p{L}0-9\s]+$/u;

const nombreServicio = Joi.string()
  .trim()
  .pattern(nombreServicioRegex)
  .messages({
    'string.base': 'El nombre del servicio debe ser texto',
    'string.empty': 'El nombre del servicio es obligatorio',
    'string.pattern.base': 'El nombre del servicio solo puede contener letras y simbolos permitidos, sin numeros',
  });

const descripcion = Joi.string()
  .trim()
  .pattern(descripcionRegex)
  .allow(null, '')
  .messages({
    'string.base': 'La descripcion debe ser texto',
    'string.pattern.base': 'La descripcion solo puede contener letras y numeros',
  });

const precio = Joi.number()
  .integer()
  .min(1000)
  .max(50000)
  .messages({
    'number.base': 'El precio debe ser un numero',
    'number.integer': 'El precio debe ser un numero entero',
    'number.min': 'El precio debe empezar desde 1000',
    'number.max': 'El precio no puede ser mayor a 50000',
  });

const duracionMinutos = Joi.number()
  .integer()
  .min(10)
  .max(60)
  .messages({
    'number.base': 'La duracion debe ser un numero',
    'number.integer': 'La duracion debe ser un numero entero',
    'number.min': 'La duracion minima es 10 minutos',
    'number.max': 'La duracion maxima es 60 minutos',
  });

export const createServiceValidation = Joi.object({
  nombre_servicio: nombreServicio.required().messages({
    'any.required': 'El nombre del servicio es obligatorio',
  }),
  descripcion: descripcion.optional(),
  precio: precio.required().messages({
    'any.required': 'El precio es obligatorio',
  }),
  duracion_minutos: duracionMinutos.required().messages({
    'any.required': 'La duracion es obligatoria',
  }),
}).unknown(false).messages({
  'object.unknown': 'No se permiten campos adicionales en la creacion de servicio',
});

export const updateServiceValidation = Joi.object({
  nombre_servicio: nombreServicio.optional(),
  descripcion: descripcion.optional(),
  precio: precio.optional(),
  duracion_minutos: duracionMinutos.optional(),
}).unknown(false).messages({
  'object.unknown': 'No se permiten campos adicionales en la edicion de servicio',
});
