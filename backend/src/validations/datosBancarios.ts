import Joi from 'joi';

const soloLetrasRegex = /^[\p{L}\s]+$/u;
const rutRegex = /^\d{8}-\d$/;
const soloNumerosRegex = /^\d+$/;

const textoSoloLetras = (campo: string) =>
  Joi.string()
    .trim()
    .pattern(soloLetrasRegex)
    .required()
    .messages({
      'string.base': `${campo} debe ser texto`,
      'string.empty': `${campo} es obligatorio`,
      'string.pattern.base': `${campo} solo puede contener letras`,
      'any.required': `${campo} es obligatorio`,
    });

export const datosBancariosValidation = Joi.object({
  nombre: textoSoloLetras('El nombre'),
  rut: Joi.string()
    .trim()
    .pattern(rutRegex)
    .required()
    .messages({
      'string.base': 'El RUT debe ser texto',
      'string.empty': 'El RUT es obligatorio',
      'string.pattern.base': 'El RUT debe tener el formato XXXXXXXX-X y solo números',
      'any.required': 'El RUT es obligatorio',
    }),
  banco: textoSoloLetras('El banco'),
  tipoCuenta: textoSoloLetras('El tipo de cuenta'),
  nroCuenta: Joi.string()
    .trim()
    .pattern(soloNumerosRegex)
    .required()
    .messages({
      'string.base': 'El número de cuenta debe ser texto',
      'string.empty': 'El número de cuenta es obligatorio',
      'string.pattern.base': 'El número de cuenta solo puede contener números',
      'any.required': 'El número de cuenta es obligatorio',
    }),
  correo: Joi.string()
    .trim()
    .email({ tlds: { allow: false } })
    .required()
    .messages({
      'string.base': 'El correo debe ser texto',
      'string.empty': 'El correo es obligatorio',
      'string.email': 'El correo no es válido',
      'any.required': 'El correo es obligatorio',
    }),
}).unknown(false).messages({
  'object.unknown': 'No se permiten campos adicionales en los datos bancarios',
});
