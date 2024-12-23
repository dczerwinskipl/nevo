namespace NEvo.Messaging.Authorization;

[AttributeUsage(AttributeTargets.Method, AllowMultiple = false)]
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
