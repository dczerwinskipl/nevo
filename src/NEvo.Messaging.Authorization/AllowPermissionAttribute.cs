namespace NEvo.Messaging.Authorization;

/// <summary>
/// May be applied to a message type to define an operation-level permission, or to a
/// handler method to add a handler-specific permission requirement — a command
/// declares its permission once, at the message level, rather than copying it onto
/// every aggregate-state method that could produce it. Message-level and handler-level
/// requirements compose as AND, never override. Only these two placements are read by
/// <see cref="ValidatePermissionMiddleware{TId}"/>; placing this attribute on a
/// handler class itself has no effect — it is not read from there.
/// </summary>
[AttributeUsage(AttributeTargets.Method | AttributeTargets.Class, AllowMultiple = false)]
public class AllowPermissionAttribute : Attribute
{
    public string PermissionName { get; }
    public Type ValidatorType { get; }

    public AllowPermissionAttribute(string name, Type validatorType)
    {
        //TODO fix that, something from with generics
        /*if (!typeof(IDataScopeMessageValidator<,>).IsAssignableFrom(validatorType))
        {
            throw new ArgumentException($"Validator type must implement IDataScopeMessageValidator<>");
        }*/

        PermissionName = name;
        ValidatorType = validatorType;
    }
}
