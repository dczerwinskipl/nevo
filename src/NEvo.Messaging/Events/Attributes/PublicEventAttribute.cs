namespace NEvo.Messaging.Events.Attributes;

[AttributeUsage(AttributeTargets.Class, AllowMultiple = true, Inherited = true)]
public class PublicEventAttribute : EventVisibilityAttribute
{
    public override bool IsPrivate => false;
}
