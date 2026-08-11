namespace NEvo.Messaging.Authorization;

/// <summary>
/// Placed on a handler method for a handler-specific requirement, or on a message
/// type for the operation's primary permission — a command declares its permission
/// once, at the message level, rather than copying it onto every aggregate-state
/// method that could produce it. Message-level and handler-level requirements compose
/// as AND, never override.
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
