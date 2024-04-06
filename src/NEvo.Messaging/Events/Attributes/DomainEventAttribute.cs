using NEvo.Messaging.Attributes;
using System.Diagnostics.CodeAnalysis;

namespace NEvo.Messaging.Events.Attributes;

[ExcludeFromCodeCoverage]
[AttributeUsage(AttributeTargets.Class, AllowMultiple = true, Inherited = true)]
public class DomainEventAttribute : MessageVisibilityAttribute
{
    public override bool IsPrivate => true;
}
