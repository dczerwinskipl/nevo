namespace NEvo.Messaging.Events.Attributes;

[AttributeUsage(AttributeTargets.Class, AllowMultiple = true, Inherited = true)]
public class DomainEventAttribute : EventVisibilityAttribute
{
    public override bool IsPrivate => true;
}
