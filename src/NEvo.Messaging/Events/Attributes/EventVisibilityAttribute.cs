namespace NEvo.Messaging.Events.Attributes;

[AttributeUsage(AttributeTargets.Class, AllowMultiple = true, Inherited = true)]
public abstract class EventVisibilityAttribute : Attribute
{
    public abstract bool IsPrivate { get; }
}
