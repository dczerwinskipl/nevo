using System.Diagnostics.CodeAnalysis;

namespace NEvo.Messaging.Events.Attributes;

[ExcludeFromCodeCoverage]
[AttributeUsage(AttributeTargets.Class, AllowMultiple = true, Inherited = true)]
public class DomainEventAttribute : EventVisibilityAttribute
{
    public override bool IsPrivate => true;
}
