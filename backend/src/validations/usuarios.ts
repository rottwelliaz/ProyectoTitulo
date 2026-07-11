import Joi from 'joi';

const nombreRegex = /^[\p{L}\s]+$/u;
const telefonoRegex = /^\d{9}$/;

const nombre = Joi.string()
  .trim()
  .pattern(nombreRegex)
  .messages({
    'string.base': 'El nombre debe ser texto',
    'string.empty': 'El nombre es obligatorio',
    'string.pattern.base': 'El nombre solo puede contener letras',
  });

const email = Joi.string()
  .trim()
  .messages({
    'string.base': 'El email debe ser texto',
    'string.empty': 'El email no puede estar vacío',
  });

const password = Joi.string()
  .messages({
    'string.base': 'El password debe ser texto',
    'string.empty': 'El password no puede estar vacío',
  });

const telefono = Joi.string()
  .trim()
  .pattern(telefonoRegex)
  .allow(null, '')
  .messages({
    'string.base': 'El teléfono debe ser texto',
    'string.pattern.base': 'El teléfono debe contener exactamente 9 números',
  });

export const createUserValidation = Joi.object({
  nombre: nombre.required().messages({
    'any.required': 'El nombre es obligatorio',
  }),
  email: email.required().messages({
    'any.required': 'El email es obligatorio',
  }),
  password: password.required().messages({
    'any.required': 'El password es obligatorio',
  }),
  telefono: telefono.optional(),
  rol: Joi.string()
    .valid('cliente', 'barbero')
    .optional()
    .messages({
      'any.only': 'Rol inválido',
      'string.base': 'El rol debe ser texto',
    }),
}).unknown(false).messages({
  'object.unknown': 'No se permiten campos adicionales en la creación de usuario',
});

export const updateUserValidation = Joi.object({
  nombre: nombre.optional(),
  email: email.optional(),
  password: password.optional(),
  telefono: telefono.optional(),
  rol: Joi.string()
    .valid('cliente', 'barbero', 'admin')
    .optional()
    .messages({
      'any.only': 'Rol inválido',
      'string.base': 'El rol debe ser texto',
    }),
  aprobado: Joi.boolean()
    .optional()
    .messages({
      'boolean.base': 'El campo aprobado debe ser verdadero o falso',
    }),
}).unknown(false).messages({
  'object.unknown': 'No se permiten campos adicionales en la edición de usuario',
});

export const updateProfileValidation = Joi.object({
  nombre: nombre.optional(),
  email: email.optional(),
  password: password.optional(),
  telefono: telefono.optional(),
}).unknown(false).messages({
  'object.unknown': 'No se permiten campos adicionales en la edición de perfil',
});
