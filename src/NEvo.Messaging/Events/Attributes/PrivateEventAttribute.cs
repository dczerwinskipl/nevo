namespace NEvo.Messaging.Events.Attributes;

[AttributeUsage(AttributeTargets.Class, AllowMultiple = true, Inherited = true)]
public class PrivateEventAttribute : EventVisibilityAttribute
{
    public override bool IsPrivate => true;
}